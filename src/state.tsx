import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { api, API_URL, ApiError } from './api';
import { createDemo } from './demo';
import { validateProfile } from './dates';
import { CLASSIFICATION_OPTIONS, ClassificationOption, CommunityMessage, MessageCategory, MemberState, Preferences, Profile, PrayerSeats, SeatingStatus, Session, YahrzeitCustom, normalizeMemberState, normalizeProfile } from './types';
import { demoHealingPrayer, healingPrayerName, refreshDemoHealing, keepDemoHealing } from './healingPrayers';
import { syncHealingInbox } from './inbox';
import { demoSeating, demoSeatReport, seatReport } from './seating';

const DEMO_KEY = 'shul.demo.v1';
const SESSION_KEY = 'shul.session.v1';
const sessionStorage = {
  get: () => Platform.OS === 'web' ? Promise.resolve(globalThis.sessionStorage?.getItem(SESSION_KEY) || null) : SecureStore.getItemAsync(SESSION_KEY),
  set: (value: string) => Platform.OS === 'web' ? Promise.resolve(globalThis.sessionStorage?.setItem(SESSION_KEY, value)) : SecureStore.setItemAsync(SESSION_KEY, value),
  remove: () => Platform.OS === 'web' ? Promise.resolve(globalThis.sessionStorage?.removeItem(SESSION_KEY)) : SecureStore.deleteItemAsync(SESSION_KEY),
};
type Context = {
  data: MemberState | null; session: Session | null; loading: boolean; error: string | null;
  isDemo: boolean; verifyPhone: (challengeId: string, code: string) => Promise<void>; logout: () => Promise<void>;
  refresh: () => Promise<void>; saveProfile: (profile: Profile) => Promise<void>;
  savePreferences: (prefs: Preferences) => Promise<void>; addReply: (id: string, body: string) => Promise<void>;
  saveCommunitySettings: (custom: YahrzeitCustom) => Promise<void>;
  addClassification: (name: string) => Promise<ClassificationOption>;
  publishMessage: (value: { category: MessageCategory; title: string; body: string; pinned: boolean }, pdf?: { name: string; base64: string }) => Promise<CommunityMessage>;
  markRead: (id: string) => Promise<void>;
  addHealingPrayer: (name: string) => Promise<void>; deleteHealingPrayer: (id: string) => Promise<void>;
  keepHealingPrayer: (id: string, cycleId: string) => Promise<void>;
  saveSeating: (value: PrayerSeats, context: SeatingStatus) => Promise<void>;
};
const StateContext = createContext<Context | null>(null);
export function StateProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<MemberState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isDemo = !API_URL;
  const dataRef = useRef(data); dataRef.current = data;
  const generation = useRef(0);
  const dataVersion = useRef(0);
  const refreshing = useRef(false);
  const commits = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (isDemo) {
          const saved = await AsyncStorage.getItem(DEMO_KEY);
          let initial = createDemo();
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.profile && parsed.preferences && Array.isArray(parsed.messages) && Array.isArray(parsed.readIds)) initial = normalizeMemberState(parsed);
            const previousSeating = initial.seating;
            initial.seating = demoSeating(new Date(), previousSeating);
            if (initial.seating !== previousSeating) await AsyncStorage.setItem(DEMO_KEY, JSON.stringify(initial));
          }
          initial.healingPrayers = refreshDemoHealing(initial.healingPrayers);
          initial = syncHealingInbox(initial);
          await AsyncStorage.setItem(DEMO_KEY, JSON.stringify(initial));
          if (mounted) setData(initial);
        } else {
          const saved = await sessionStorage.get();
          if (saved && mounted) setSession(JSON.parse(saved));
        }
      } catch {
        if (mounted) {
          if (isDemo) setData(createDemo());
          setError('לא ניתן לטעון את הנתונים השמורים. אפשר להתחיל מחדש או לנסות לפתוח שוב את האפליקציה.');
        }
      }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [isDemo]);

  const refresh = useCallback(async () => {
    if (isDemo) {
      const existing = dataRef.current?.seating;
      const next = demoSeating(new Date(), existing);
      if (dataRef.current) await commit(value => ({ ...value, seating: next, healingPrayers: refreshDemoHealing(value.healingPrayers) }), generation.current);
      return;
    }
    if (!session || refreshing.current) return;
    refreshing.current = true;
    const current = generation.current;
    const version = dataVersion.current;
    try {
      const fresh = normalizeMemberState(await api.state(session.token));
      if (current === generation.current && version === dataVersion.current) { dataRef.current = fresh; setData(fresh); setError(null); }
    } catch (e) {
      if (current !== generation.current) return;
      if (e instanceof ApiError && e.status === 401) {
        generation.current += 1;
        dataRef.current = null;
        setSession(null); setData(null); await sessionStorage.remove();
      }
      setError(e instanceof Error ? e.message : 'עדכון הנתונים נכשל.');
      throw e;
    } finally { refreshing.current = false; }
  }, [isDemo, session]);
  useEffect(() => {
    if (!session && !isDemo) return;
    void refresh().catch(() => {});
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh().catch(() => {}); }, 30000);
    const sub = AppState.addEventListener('change', value => { if (value === 'active') void refresh().catch(() => {}); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [refresh, session, isDemo]);

  async function commit(update: (value: MemberState) => MemberState, current: number) {
    const pending = commits.current.then(async () => {
      if (current !== generation.current || !dataRef.current) return;
      const next = syncHealingInbox(update(dataRef.current));
      if (isDemo) await AsyncStorage.setItem(DEMO_KEY, JSON.stringify(next));
      if (current !== generation.current) return;
      dataVersion.current += 1;
      dataRef.current = next;
      setData(next);
    });
    commits.current = pending.catch(() => {});
    await pending;
  }
  async function verifyPhone(challengeId: string, code: string) {
    await acceptSession(await api.verifyPhoneCode(challengeId, code));
  }
  async function acceptSession(nextSession: Session) {
    try {
      const nextData = normalizeMemberState(await api.state(nextSession.token));
      await sessionStorage.set(JSON.stringify(nextSession));
      generation.current += 1;
      dataRef.current = nextData; setData(nextData); setSession(nextSession); setError(null);
    } catch (e) { await api.logout(nextSession.token).catch(() => {}); throw e; }
  }
  async function logout() {
    if (session) await api.logout(session.token);
    await sessionStorage.remove();
    generation.current += 1;
    dataRef.current = null;
    setSession(null); setData(null); setError(null);
  }
  async function saveProfile(profile: Profile) {
    profile = normalizeProfile(profile);
    const validation = validateProfile(profile);
    if (validation) throw new Error(validation);
    const current = generation.current; dataVersion.current += 1;
    const saved = session ? await api.profile(session.token, profile) : profile;
    await commit(value => ({ ...value, profile: saved }), current);
  }
  async function savePreferences(preferences: Preferences) {
    const current = generation.current; dataVersion.current += 1;
    const saved = session ? await api.preferences(session.token, preferences) : preferences;
    await commit(value => ({ ...value, preferences: saved }), current);
  }
  async function saveCommunitySettings(custom: YahrzeitCustom) {
    if (!session || dataRef.current?.role !== 'gabbai') throw new Error('שינוי מנהג הקהילה מיועד לגבאים בלבד.');
    const current = generation.current; dataVersion.current += 1;
    const saved = await api.saveCommunitySettings(session.token, custom);
    await commit(value => ({ ...value, communitySettings: saved }), current);
  }
  async function addReply(id: string, body: string) {
    const text = body.trim();
    if (!text || text.length > 1000) throw new Error('התגובה צריכה להכיל בין תו אחד ל־1,000 תווים.');
    const message = dataRef.current?.messages.find(m => m.id === id);
    if (!message || !['celebration', 'condolence'].includes(message.category)) throw new Error('ניתן להגיב להודעות מזל טוב ותנחומים בלבד.');
    const current = generation.current; dataVersion.current += 1;
    const reply = session ? await api.reply(session.token, id, text) : { id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`, author: dataRef.current?.profile.name || 'חבר/ת הקהילה', body: text, createdAt: new Date().toISOString() };
    await commit(value => ({ ...value, messages: value.messages.map(m => m.id === id ? { ...m, replies: [...m.replies.filter(r => r.id !== reply.id), reply] } : m) }), current);
  }
  async function addClassification(name: string) {
    if (!session || dataRef.current?.role !== 'gabbai') throw new Error('הוספת סיווג מיועדת לגבאים בלבד.');
    const current = generation.current; dataVersion.current += 1;
    const added = await api.addClassification(session.token, name.trim());
    await commit(state => ({ ...state, classifications: [...(state.classifications?.length ? state.classifications : CLASSIFICATION_OPTIONS).filter(option => option.value !== added.value), added] }), current);
    return added;
  }
  async function publishMessage(value: { category: MessageCategory; title: string; body: string; pinned: boolean }, pdf?: { name: string; base64: string }) {
    if (!session || dataRef.current?.role !== 'gabbai') throw new Error('פרסום מיועד לגבאים בלבד.');
    const current = generation.current; dataVersion.current += 1;
    const added = pdf ? await api.publishPdf(session.token, { name: pdf.name, base64: pdf.base64, title: value.title, body: value.body }) : await api.publish(session.token, value);
    await commit(state => ({ ...state, messages: [added, ...state.messages.filter(message => message.id !== added.id)] }), current);
    return added;
  }
  async function markRead(id: string) {
    if (dataRef.current?.readIds.includes(id)) return;
    const current = generation.current; dataVersion.current += 1;
    if (session) {
      try { await api.read(session.token, id); }
      catch (error) {
        // Another device may resolve/expire the reminder while it is opening.
        if (error instanceof ApiError && error.status === 404) { await refresh(); return; }
        throw error;
      }
    }
    await commit(value => ({ ...value, readIds: [...new Set([...value.readIds, id])] }), current);
  }
  async function addHealingPrayer(value: string) {
    const name = healingPrayerName(value);
    if (!dataRef.current) throw new Error('יש להתחבר מחדש.');
    if (dataRef.current.healingPrayers.some(entry => entry.name === name)) throw new Error('השם כבר מופיע ברשימה שלך.');
    const current = generation.current; dataVersion.current += 1;
    const added = session ? await api.addHealingPrayer(session.token, name) : demoHealingPrayer(name, dataRef.current.profile.name);
    await commit(state => ({ ...state, healingPrayers: [added, ...state.healingPrayers.filter(entry => entry.id !== added.id)] }), current);
  }
  async function deleteHealingPrayer(id: string) {
    if (!dataRef.current?.healingPrayers.some(entry => entry.id === id)) throw new Error('השם לא נמצא ברשימה שלך.');
    const current = generation.current; dataVersion.current += 1;
    if (session) await api.deleteHealingPrayer(session.token, id);
    await commit(state => ({ ...state, healingPrayers: state.healingPrayers.filter(entry => entry.id !== id) }), current);
  }
  async function keepHealingPrayer(id: string, cycleId: string) {
    const entry = dataRef.current?.healingPrayers.find(row => row.id === id);
    if (!entry) throw new Error('השם לא נמצא ברשימה שלך.');
    const current = generation.current; dataVersion.current += 1;
    try {
      const saved = session ? await api.keepHealingPrayer(session.token, id, cycleId) : keepDemoHealing(entry, cycleId);
      await commit(state => ({ ...state, healingPrayers: state.healingPrayers.map(row => row.id === id ? saved : row) }), current);
    } catch (error) {
      if (error instanceof ApiError && [404, 409].includes(error.status)) await refresh().catch(() => {});
      throw error;
    }
  }
  async function saveSeating(value: PrayerSeats, context: SeatingStatus) {
    const payload = seatReport(context, value);
    const current = generation.current; dataVersion.current += 1;
    const saved = session ? await api.saveSeating(session.token, payload) : demoSeatReport(dataRef.current?.seating || demoSeating(), context, value);
    await commit(state => ({ ...state, seating: saved }), current);
  }
  return <StateContext.Provider value={{ data, session, loading, error, isDemo, verifyPhone, logout, refresh, saveProfile, savePreferences, saveCommunitySettings, addReply, addClassification, publishMessage, markRead, addHealingPrayer, deleteHealingPrayer, keepHealingPrayer, saveSeating }}>{children}</StateContext.Provider>;
}
export function useCommunity() {
  const value = useContext(StateContext);
  if (!value) throw new Error('StateProvider is required');
  return value;
}

import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { openPdf } from '../pdf';
import { relativeDate } from '../dates';
import { useCommunity } from '../state';
import { CATEGORY, CommunityMessage, MessageCategory } from '../types';
import { Button, C, ErrorText, s } from '../ui';

export function MessageCard({ message, unread, onPress }: { message: CommunityMessage; unread: boolean; onPress: () => void }) {
  const cat = CATEGORY[message.category];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${unread ? 'הודעה חדשה: ' : ''}${message.title}`} onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.75 }]}><View style={s.between}><View style={s.row}><View style={{ backgroundColor: cat.background, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ color: cat.color, fontSize: 12, fontWeight: '600' }}>{cat.symbol}  {cat.label}</Text></View>{message.pinned && <Text style={s.muted}>נעוצה</Text>}</View>{unread && <View accessibilityLabel="טרם נקראה" style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.green }} />}</View><Text style={s.heading}>{message.title}</Text><Text numberOfLines={2} style={s.muted}>{message.body.replace(/\n+/g, ' ')}</Text><View style={s.between}><Text style={s.muted}>{relativeDate(message.createdAt)}</Text>{['celebration', 'condolence'].includes(message.category) && <Text style={[s.muted, { color: C.green }]}>{message.replies.length ? `${message.replies.length} תגובות` : 'כתיבת תגובה'} ←</Text>}</View></Pressable>;
}
export function Messages({ onMessage }: { onMessage: (id: string) => void }) {
  const { data, refresh } = useCommunity();
  const [filter, setFilter] = useState<MessageCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const filtered = data.messages.filter(m => (filter === 'all' || m.category === filter) && `${m.title} ${m.body}`.includes(query.trim())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
  async function reload() { setBusy(true); setError(null); try { await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'רענון ההודעות נכשל.'); } finally { setBusy(false); } }
  return <ScrollView style={s.page} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={busy} onRefresh={reload} tintColor={C.green} />}><View style={{ gap: 5 }}><Text style={s.title}>לוח הקהילה</Text><Text style={s.muted}>העדכונים, השמחות והרגעים שלנו יחד.</Text></View><TextInput accessibilityLabel="חיפוש בהודעות" placeholder="חיפוש בלוח הקהילה…" placeholderTextColor={C.muted} value={query} onChangeText={setQuery} style={s.input} /><View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>{([{ value: 'all', label: 'הכול' }, ...Object.entries(CATEGORY).map(([value, c]) => ({ value, label: c.label }))] as { value: MessageCategory | 'all'; label: string }[]).map(c => <Pressable key={c.value} accessibilityRole="button" accessibilityState={{ selected: filter === c.value }} onPress={() => setFilter(c.value)} style={[s.chip, filter === c.value && { backgroundColor: C.green, borderColor: C.green }]}><Text style={{ color: filter === c.value ? '#FFFFFF' : C.ink, fontSize: 14 }}>{c.label}</Text></Pressable>)}</View><ErrorText error={error} />{filtered.length ? filtered.map(m => <MessageCard key={m.id} message={m} unread={!data.readIds.includes(m.id)} onPress={() => onMessage(m.id)} />) : <View style={s.card}><Text style={s.heading}>אין כאן הודעות כרגע</Text><Text style={s.muted}>{query ? 'אפשר לנסות מילות חיפוש אחרות.' : 'הודעות חדשות מהגבאים יופיעו כאן.'}</Text></View>}<Text style={s.muted}>העדפות ההתראות קובעות אילו עדכונים יישלחו אליך. כל ההודעות זמינות לעיון בלוח.</Text></ScrollView>;
}
export function MessageDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, addReply, isDemo, session } = useCommunity();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const message = data?.messages.find(m => m.id === id);
  if (!message) return <View style={s.content}><Text style={s.heading}>ההודעה אינה זמינה</Text><Button title="חזרה ללוח" onPress={onClose} /></View>;
  const cat = CATEGORY[message.category];
  const canReply = ['celebration', 'condolence'].includes(message.category);
  async function attachment() {
    if (!message?.attachment || !session) return;
    setBusy(true); setError(null);
    try { await openPdf(message.attachment, session.token); }
    catch (e) { setError(e instanceof Error ? e.message : 'פתיחת הקובץ נכשלה.'); }
    finally { setBusy(false); }
  }
  async function send() {
    setBusy(true); setError(null);
    try { await addReply(id, body); setBody(''); } catch (e) { setError(e instanceof Error ? e.message : 'שליחת התגובה נכשלה.'); } finally { setBusy(false); }
  }
  return <ScrollView style={s.page} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}><Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}><Text style={[s.text, { color: C.green }]}>→ חזרה ללוח הקהילה</Text></Pressable><View style={{ alignSelf: 'flex-end', backgroundColor: cat.background, padding: 9, borderRadius: 9 }}><Text style={{ color: cat.color }}>{cat.label}</Text></View><Text style={s.title}>{message.title}</Text><Text style={s.muted}>{message.author} · {relativeDate(message.createdAt)}</Text><View style={s.card}><Text selectable style={s.text}>{message.body}</Text>{message.attachment && <><Text style={s.muted}>{message.attachment.name}</Text><Button title="פתיחה / שמירת קובץ PDF" busy={busy} onPress={() => void attachment()} /></>}<ErrorText error={error} /></View>{canReply && <><Text style={s.heading}>מילים מהקהילה · {message.replies.length}</Text>{message.replies.map(reply => <View key={reply.id} style={s.card}><View style={s.between}><Text style={[s.text, { fontWeight: '700' }]}>{reply.author}</Text><Text style={s.muted}>{relativeDate(reply.createdAt)}</Text></View><Text selectable style={s.text}>{reply.body}</Text></View>)}<View style={s.card}><Text style={s.heading}>{message.category === 'celebration' ? 'מצטרפים לברכות' : 'משאירים מילה של נחמה'}</Text><TextInput accessibilityLabel="כתיבת תגובה" value={body} onChangeText={setBody} editable={!busy} multiline maxLength={1000} placeholder={message.category === 'celebration' ? 'מזל טוב והרבה נחת…' : 'המקום ינחם אתכם…'} placeholderTextColor={C.muted} style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]} /><Text style={s.muted}>{body.length}/1000 · התגובה גלויה לחברי הקהילה</Text><ErrorText error={error} /><Button title={isDemo ? 'הוספת תגובה בהדגמה' : 'פרסום תגובה'} onPress={() => void send()} busy={busy} disabled={!body.trim()} />{isDemo && <Text style={s.muted}>התגובה נשמרת במכשיר בלבד.</Text>}</View></>}</ScrollView>;
}

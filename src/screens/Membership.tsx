import React, { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import { useCommunity } from '../state';
import { Button, Choice, ErrorText, s } from '../ui';
import { isManagement } from '../client/roles.ts';

export function Membership({ onClose }: { onClose: () => void }) {
  const { data, session, refresh } = useCommunity();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    setRefreshing(true); setError(null);
    try { await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'הרענון נכשל.'); }
    finally { setRefreshing(false); }
  }
  async function classify(id: string) {
    const classification = choices[id];
    if (!session || (classification !== 'א' && classification !== 'קבוע')) return;
    setBusy(id); setError(null);
    try { await api.classifyMember(session.token, id, classification); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'שמירת הסיווג נכשלה.'); }
    finally { setBusy(null); }
  }
  if (!data || !isManagement(data.role)) return null;
  return <ScrollView style={s.page} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />}>
    <Button title="חזרה לבית" secondary onPress={onClose} />
    <Text style={s.title}>מתפללים חדשים לסיווג</Text>
    <ErrorText error={error} />
    {!data.membershipRequests?.length && <Text style={s.text}>אין מתפללים שממתינים לסיווג.</Text>}
    {data.membershipRequests?.map(request => <View key={request.id} style={s.card}>
      <Text style={s.heading}>{request.profile.name}</Text>
      <Text style={s.muted}>{request.email}</Text>
      {!!request.profile.phone && <Text style={s.text}>{request.profile.phone}</Text>}
      <Text style={s.muted}>ילדים במשפחה: {request.profile.children.length}</Text>
      <Choice label="סיווג המתפלל" value={choices[request.id] || ''} options={[{ value: '', label: 'בחירת סיווג' }, { value: 'א', label: 'א — חבר עמותה' }, { value: 'קבוע', label: 'קבוע — אינו חבר עמותה' }]} disabled={busy !== null} onChange={value => setChoices(current => ({ ...current, [request.id]: value }))} />
      <Button title="שמירת הסיווג" onPress={() => void classify(request.id)} busy={busy === request.id} disabled={busy !== null || !choices[request.id]} />
    </View>)}
  </ScrollView>;
}

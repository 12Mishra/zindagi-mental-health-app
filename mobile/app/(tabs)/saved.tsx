import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ZColors } from '@/constants/zindagi-theme';
import { getAuthSession } from '@/lib/auth-session';
import { deleteConversation, getSavedConversations, type SavedConversation } from '@/lib/conversation-api';

export default function SavedSessionsScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SavedConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const token = getAuthSession()?.session.token;
    if (!token) { router.replace('/login'); return; }
    setLoading(true);
    try {
      setSessions(await getSavedConversations(token));
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load saved sessions.');
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void refresh(); }, [refresh]);

  const remove = async (id: string) => {
    const token = getAuthSession()?.session.token;
    if (!token) return;
    setDeletingId(id);
    try {
      await deleteConversation(token, id);
      setSessions(current => current.filter(item => item.id !== id));
      setConfirmId(null);
      setNotice('Session data deleted.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete session data.');
    } finally { setDeletingId(null); }
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <View>
        <Text style={styles.title}>Saved sessions</Text>
        <Text style={styles.subtitle}>Only sessions saved with your consent appear here.</Text>
      </View>
      <TouchableOpacity onPress={() => void refresh()} disabled={loading} accessibilityLabel="Refresh saved sessions">
        <MaterialIcons name="refresh" size={26} color={ZColors.forest} />
      </TouchableOpacity>
    </View>
    {loading && <ActivityIndicator color={ZColors.olive} />}
    {!!notice && <Text style={styles.notice}>{notice}</Text>}
    <ScrollView contentContainerStyle={styles.list}>
      {!loading && !sessions.length && <Text style={styles.empty}>No saved sessions yet.</Text>}
      {sessions.map(item => <View key={item.id} style={styles.card}>
        <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
        <Text style={styles.status}>Summary: {item.summaryJob?.state.toLowerCase() ?? 'not requested'}</Text>
        {item.summary ? <>
          <Text style={styles.summary}>{item.summary.summary}</Text>
          {!!item.summary.keyThemes.length && <Text style={styles.themes}>Themes: {item.summary.keyThemes.join(', ')}</Text>}
        </> : <Text style={styles.pending}>A summary will appear here if its job completes successfully.</Text>}
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => setConfirmId(confirmId === item.id ? null : item.id)}>
            <Text style={styles.delete}>Delete session data</Text>
          </TouchableOpacity>
          {confirmId === item.id && <TouchableOpacity onPress={() => void remove(item.id)} disabled={deletingId === item.id}>
            <Text style={styles.confirm}>{deletingId === item.id ? 'Deleting...' : 'Confirm deletion'}</Text>
          </TouchableOpacity>}
        </View>
      </View>)}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ZColors.cream },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: ZColors.forest },
  subtitle: { color: ZColors.textSecondary, marginTop: 4, maxWidth: 280 },
  notice: { color: ZColors.coralDeep, paddingHorizontal: 20, paddingBottom: 8 },
  list: { padding: 20, paddingTop: 4, gap: 12 },
  empty: { color: ZColors.textSecondary },
  card: { backgroundColor: ZColors.creamCard, borderRadius: 14, padding: 16, gap: 9 },
  date: { color: ZColors.textPrimary, fontWeight: '700' },
  status: { color: ZColors.olive, textTransform: 'capitalize' },
  summary: { color: ZColors.textPrimary, lineHeight: 21 },
  themes: { color: ZColors.textSecondary, fontSize: 12 },
  pending: { color: ZColors.textSecondary, fontStyle: 'italic' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, gap: 12 },
  delete: { color: ZColors.coralDeep, fontWeight: '600' },
  confirm: { color: ZColors.coralDeep, fontWeight: '800' },
});

import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZRadius } from '@/constants/zindagi-theme';
import { getAuthSession } from '@/lib/auth-session';
import {
  chatSocket, dayOf, fmtMsgDay, fmtMsgTime, getChatPage, markChatRead, MAX_BODY, newClientId, sendChatMessage, useChatEvents,
  type ChatMessage, type ChatPage,
} from '@/lib/chat-api';

type Local = ChatMessage & { pending?: boolean; failed?: boolean };

function merge(list: Local[], incoming: Local[]): Local[] {
  const out = [...list];
  for (const m of incoming) {
    const i = out.findIndex(x => x.id === m.id || (!!m.clientId && x.clientId === m.clientId));
    if (i >= 0) out[i] = m; else out.push(m);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const HELPLINES = [
  { label: 'Tele-MANAS (24×7, free)', number: '14416' },
  { label: 'Emergency', number: '112' },
];

export default function ChatScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = getAuthSession()?.session.token;
  const [page, setPage] = useState<ChatPage | null>(null);
  const [messages, setMessages] = useState<Local[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [typing, setTyping] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const load = useCallback(async () => {
    if (!token) { router.replace('/login'); return; }
    if (!id) return;
    try {
      const p = await getChatPage(token, id);
      setPage(p);
      setMessages(ms => merge(ms.filter(m => m.pending || m.failed), p.messages));
      setError('');
      void markChatRead(token, id).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this conversation.');
    } finally { setLoading(false); }
  }, [token, id, router]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  const state = useChatEvents(e => {
    if (e.threadId !== id) return;
    if (e.type === 'message') {
      setMessages(ms => merge(ms, [e.message]));
      if (e.message.from === 'THERAPIST') {
        setTyping(false);
        if (token) void markChatRead(token, id).catch(() => {});
      }
    } else if (e.type === 'read' && e.by === 'THERAPIST') {
      setPage(p => (p ? { ...p, thread: { ...p.thread, otherLastReadAt: e.at } } : p));
    } else if (e.type === 'typing' && e.by === 'THERAPIST') {
      setTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 4000);
    }
  }, () => void load());

  useEffect(() => {
    if (atBottom.current) setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 30);
  }, [messages, typing]);

  async function deliver(m: Local) {
    if (!token) return;
    try {
      const res = await sendChatMessage(token, m.threadId, m.body, m.clientId!);
      setMessages(ms => merge(ms, [res.message]));
      if (res.safety === 'URGENT') setShowHelp(true);
    } catch (e) {
      setMessages(ms => ms.map(x => (x.clientId === m.clientId ? { ...x, pending: false, failed: true } : x)));
      setError(e instanceof Error ? e.message : 'Message not sent.');
    }
  }

  function send() {
    const body = draft.trim();
    if (!body || !id) return;
    const local: Local = { id: `local-${newClientId()}`, threadId: id, from: 'STUDENT', body, clientId: newClientId(), createdAt: new Date().toISOString(), pending: true };
    setDraft(''); setError('');
    atBottom.current = true;
    setMessages(ms => merge(ms, [local]));
    void deliver(local);
  }

  function onChange(text: string) {
    setDraft(text);
    const now = Date.now();
    if (id && text && now - lastTypingSent.current > 1500) { lastTypingSent.current = now; chatSocket.send({ type: 'typing', threadId: id }); }
  }

  async function loadOlder() {
    if (!token || !id || !messages.length) return;
    setLoadingOlder(true);
    atBottom.current = false;
    try {
      const older = await getChatPage(token, id, messages[0].createdAt);
      setMessages(ms => merge(ms, older.messages));
      setPage(p => (p ? { ...p, hasMore: older.hasMore } : p));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load older messages.'); }
    finally { setLoadingOlder(false); }
  }

  const lastMine = [...messages].reverse().find(m => m.from === 'STUDENT' && !m.pending && !m.failed);
  // "Seen" sits under the conversation, so only show it when the newest message is ours.
  const seen = !!(lastMine && messages[messages.length - 1] === lastMine && page?.thread.otherLastReadAt && page.thread.otherLastReadAt >= lastMine.createdAt);

  return <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back"><MaterialIcons name="arrow-back" size={26} color={ZColors.forest} /></TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{page?.thread.title ?? 'Counsellor'}</Text>
        <Text style={styles.status}>{typing ? 'typing…' : state === 'live' ? 'Counsellor · replies in office hours' : state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</Text>
      </View>
      <TouchableOpacity onPress={() => setShowHelp(v => !v)} accessibilityLabel="Urgent help">
        <MaterialIcons name="support" size={24} color={ZColors.coralDeep} />
      </TouchableOpacity>
    </View>

    {showHelp ? <View style={styles.help}>
      <Text style={styles.helpTitle}>If you might act on thoughts of hurting yourself, please reach someone now</Text>
      <Text style={styles.helpText}>Your counsellor has been alerted, but may not see this straight away.</Text>
      {HELPLINES.map(h => <TouchableOpacity key={h.number} style={styles.helpBtn} onPress={() => void Linking.openURL(`tel:${h.number}`)}>
        <MaterialIcons name="call" size={18} color="#fff" />
        <Text style={styles.helpBtnText}>{h.label}: {h.number}</Text>
      </TouchableOpacity>)}
      <TouchableOpacity onPress={() => router.push('/trusted-contacts')}><Text style={styles.helpLink}>Reach someone I trust</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => setShowHelp(false)}><Text style={styles.helpClose}>Close</Text></TouchableOpacity>
    </View> : <View style={styles.notice}>
      <MaterialIcons name="info-outline" size={16} color={ZColors.forest} />
      <Text style={styles.noticeText}>Not for emergencies. In a crisis, tap the red icon above for helplines.</Text>
    </View>}

    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroller} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
        onScroll={e => { const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent; atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80; }}
        scrollEventThrottle={100}>
        {loading ? <ActivityIndicator color={ZColors.olive} style={{ marginTop: 40 }} /> : <>
          {page?.hasMore && <TouchableOpacity style={styles.older} disabled={loadingOlder} onPress={() => void loadOlder()}>
            <Text style={styles.olderText}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</Text>
          </TouchableOpacity>}
          {messages.length === 0 && <View style={styles.empty}>
            <MaterialIcons name="chat-bubble-outline" size={32} color={ZColors.sage} />
            <Text style={styles.emptyText}>Say hello. You can ask about timings, rescheduling, or anything you’d like your counsellor to know before you meet.</Text>
          </View>}
          {messages.map((m, i) => {
            const mine = m.from === 'STUDENT';
            const newDay = i === 0 || dayOf(messages[i - 1].createdAt) !== dayOf(m.createdAt);
            return <View key={m.clientId ?? m.id}>
              {newDay && <Text style={styles.day}>{dayOf(m.createdAt) === dayOf(new Date()) ? 'Today' : fmtMsgDay(m.createdAt)}</Text>}
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs, m.failed && { opacity: 0.6 }]}>
                <Text style={[styles.body, mine && { color: '#fff' }]}>{m.body}</Text>
                {m.failed
                  ? <TouchableOpacity onPress={() => { setMessages(ms => merge(ms, [{ ...m, pending: true, failed: false }])); void deliver(m); }}>
                    <Text style={[styles.meta, styles.metaMine]}>Not sent · tap to retry</Text>
                  </TouchableOpacity>
                  : <Text style={[styles.meta, mine && styles.metaMine]}>{m.pending ? 'Sending…' : fmtMsgTime(m.createdAt)}</Text>}
              </View>
            </View>;
          })}
          {seen && !typing && <Text style={styles.seen}>Seen</Text>}
          {typing && <View style={[styles.bubble, styles.theirs]}><Text style={styles.meta}>typing…</Text></View>}
        </>}
      </ScrollView>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.composer}>
        <TextInput style={styles.input} value={draft} onChangeText={onChange} placeholder="Message your counsellor" multiline maxLength={MAX_BODY}
          placeholderTextColor={ZColors.textMuted} accessibilityLabel="Message" />
        <TouchableOpacity style={[styles.sendBtn, !draft.trim() && { opacity: 0.4 }]} disabled={!draft.trim()} onPress={send} accessibilityLabel="Send">
          <MaterialIcons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ZColors.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: ZColors.creamDark },
  title: { color: ZColors.textPrimary, fontSize: 18, fontWeight: '700' },
  status: { color: ZColors.textMuted, fontSize: 12, marginTop: 1 },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: ZColors.sageLight, paddingHorizontal: 16, paddingVertical: 8 },
  noticeText: { flex: 1, color: ZColors.forest, fontSize: 12, lineHeight: 17 },
  help: { backgroundColor: ZColors.coralLight, padding: 16, gap: 8 },
  helpTitle: { color: ZColors.textPrimary, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  helpText: { color: ZColors.textSecondary, fontSize: 13, lineHeight: 19 },
  helpBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: ZColors.coralDeep, borderRadius: ZRadius.pill, paddingVertical: 11 },
  helpBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  helpLink: { color: ZColors.forest, fontWeight: '700', textAlign: 'center', paddingVertical: 4 },
  helpClose: { color: ZColors.textSecondary, fontWeight: '600', textAlign: 'center' },
  list: { padding: 16, gap: 6, flexGrow: 1 },
  older: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  olderText: { color: ZColors.olive, fontWeight: '700', fontSize: 13 },
  empty: { alignItems: 'center', gap: 10, marginTop: 40, paddingHorizontal: 24 },
  emptyText: { color: ZColors.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  day: { alignSelf: 'center', color: ZColors.textMuted, fontSize: 12, fontWeight: '700', marginVertical: 8 },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, gap: 3 },
  mine: { alignSelf: 'flex-end', backgroundColor: ZColors.olive, borderBottomRightRadius: 5 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 5 },
  body: { color: ZColors.textPrimary, fontSize: 15, lineHeight: 21 },
  meta: { color: ZColors.textMuted, fontSize: 11, alignSelf: 'flex-end' },
  metaMine: { color: 'rgba(255,255,255,0.8)' },
  seen: { alignSelf: 'flex-end', color: ZColors.textMuted, fontSize: 11, marginTop: -2 },
  error: { color: ZColors.coralDeep, fontSize: 13, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: ZColors.creamDark, backgroundColor: ZColors.cream },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 15, maxHeight: 120, color: ZColors.textPrimary },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: ZColors.olive, alignItems: 'center', justifyContent: 'center' },
});

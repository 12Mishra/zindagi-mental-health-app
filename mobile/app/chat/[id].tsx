import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Moss } from '@/components/moss/moss';
import { Backdrop } from '@/components/z/backdrop';
import { PressScale, ZButton } from '@/components/z/press';
import { Clay, Frost } from '@/components/z/surfaces';
import { TypingDots } from '@/components/z/typing-dots';
import { webNoOutline, ZColors, ZFont, ZGradients, ZShadow } from '@/constants/zindagi-theme';
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
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
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

  // Opening the keyboard shrinks the list; keep the latest messages (and what is being typed) in view.
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      atBottom.current = true;
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    });
    return () => sub.remove();
  }, []);

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

  const initial = (page?.thread.title ?? 'Counsellor').replace(/^Dr\.?\s*/, '').charAt(0).toUpperCase();

  return <View style={styles.root}>
    <Backdrop variant="calm" />
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
      <Frost radius={24} style={styles.header}>
        <View style={styles.headerInner}>
          <PressScale onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button" style={styles.iconBtn}>
            <MaterialIcons name="arrow-back-ios-new" size={18} color={ZColors.forest} />
          </PressScale>
          <View style={styles.avatar}>
            <LinearGradient colors={ZGradients.coral} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
            <Text style={styles.avatarText}>{initial}</Text>
            <View style={[styles.presence, { backgroundColor: state === 'live' ? '#7BC46A' : ZColors.sage }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{page?.thread.title ?? 'Counsellor'}</Text>
            <Text style={[styles.status, typing && { color: ZColors.olive }]}>{typing ? 'typing…' : state === 'live' ? 'Counsellor · replies in office hours' : state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</Text>
          </View>
          <PressScale onPress={() => setShowHelp(v => !v)} accessibilityLabel="Urgent help" accessibilityRole="button" style={[styles.iconBtn, styles.sos]}>
            <MaterialIcons name="support" size={20} color={ZColors.coralDeep} />
          </PressScale>
        </View>
      </Frost>

      {showHelp ? <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.help}>
        <Text style={styles.helpTitle}>If you might act on thoughts of hurting yourself, please reach someone now</Text>
        <Text style={styles.helpText}>Your counsellor has been alerted, but may not see this straight away.</Text>
        {HELPLINES.map(h => <ZButton key={h.number} variant="coral" icon="call" label={`${h.label}: ${h.number}`} onPress={() => void Linking.openURL(`tel:${h.number}`)} />)}
        <ZButton variant="ghost" compact label="Reach someone I trust" onPress={() => router.push('/trusted-contacts')} />
        <ZButton variant="ghost" compact label="Close" onPress={() => setShowHelp(false)} />
      </Animated.View> : <View style={styles.notice}>
        <MaterialIcons name="info-outline" size={15} color={ZColors.forest} />
        <Text style={styles.noticeText}>Not for emergencies. In a crisis, tap the red icon above for helplines.</Text>
      </View>}

      {/* Android is edge-to-edge, so the window no longer resizes for the keyboard: pad on both platforms. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView ref={scroller} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onScroll={e => { const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent; atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80; }}
          scrollEventThrottle={100} showsVerticalScrollIndicator={false}>
          {loading ? <ActivityIndicator color={ZColors.olive} style={{ marginTop: 40 }} /> : <>
            {page?.hasMore && <ZButton variant="ghost" compact label={loadingOlder ? 'Loading…' : 'Load earlier messages'} disabled={loadingOlder} onPress={() => void loadOlder()} style={{ alignSelf: 'center' }} />}
            {messages.length === 0 && <Animated.View entering={FadeIn.duration(400)} style={styles.empty}>
              <Moss expression="calm" size={130} />
              <Text style={styles.emptyText}>Say hello. You can ask about timings, rescheduling, or anything you’d like your counsellor to know before you meet.</Text>
            </Animated.View>}
            {messages.map((m, i) => {
              const mine = m.from === 'STUDENT';
              const prev = messages[i - 1];
              const newDay = i === 0 || dayOf(prev.createdAt) !== dayOf(m.createdAt);
              const grouped = !newDay && prev && prev.from === m.from;
              return <View key={m.clientId ?? m.id}>
                {newDay && <Text style={styles.day}>{dayOf(m.createdAt) === dayOf(new Date()) ? 'Today' : fmtMsgDay(m.createdAt)}</Text>}
                <Animated.View entering={FadeInDown.springify().damping(15).stiffness(190)}
                  style={[styles.bubbleWrap, mine ? styles.mineWrap : styles.theirsWrap, grouped && { marginTop: -2 }, m.failed && { opacity: 0.6 }]}>
                  {mine && <LinearGradient colors={ZGradients.gloss} style={[StyleSheet.absoluteFill, styles.mineShape]} />}
                  <View style={[styles.bubble, mine ? styles.mineShape : styles.theirs]}>
                    <Text style={[styles.body, mine && { color: '#fff' }]}>{m.body}</Text>
                    {m.failed
                      ? <PressScale onPress={() => { setMessages(ms => merge(ms, [{ ...m, pending: true, failed: false }])); void deliver(m); }}>
                        <Text style={[styles.meta, styles.metaMine]}>Not sent · tap to retry</Text>
                      </PressScale>
                      : <View style={styles.metaRow}>
                        <Text style={[styles.meta, mine && styles.metaMine]}>{m.pending ? 'Sending…' : fmtMsgTime(m.createdAt)}</Text>
                        {mine && !m.pending && <MaterialIcons name="done-all" size={13} color={seen && m === lastMine ? '#D9F2B8' : 'rgba(255,255,255,0.7)'} />}
                      </View>}
                  </View>
                </Animated.View>
              </View>;
            })}
            {seen && !typing && <Text style={styles.seen}>Seen</Text>}
            {typing && <Animated.View entering={FadeInDown.springify()} style={[styles.bubbleWrap, styles.theirsWrap]}>
              <View style={[styles.bubble, styles.theirs, { paddingVertical: 13 }]}><TypingDots /></View>
            </Animated.View>}
          </>}
        </ScrollView>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.composer}>
          <Clay radius={22} flat style={styles.inputShell}>
            <TextInput style={styles.input} value={draft} onChangeText={onChange} placeholder="Message your counsellor" multiline maxLength={MAX_BODY}
              placeholderTextColor={ZColors.textMuted} accessibilityLabel="Message" />
          </Clay>
          <PressScale disabled={!draft.trim()} onPress={send} accessibilityLabel="Send" accessibilityRole="button" style={styles.sendBtn}>
            <LinearGradient colors={ZGradients.gloss} style={[StyleSheet.absoluteFill, { borderRadius: 18 }]} />
            <MaterialIcons name="arrow-upward" size={22} color="#fff" />
          </PressScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ZColors.canvas },
  header: { marginHorizontal: 10, marginTop: 4 },
  headerInner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sos: { backgroundColor: 'rgba(224,92,71,0.1)' },
  avatar: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', ...ZShadow.subtle },
  avatarText: { color: '#fff', fontFamily: ZFont.display, fontSize: 17 },
  presence: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#F7FAF3' },
  title: { color: ZColors.ink, fontSize: 16.5, fontFamily: ZFont.heavy },
  status: { color: ZColors.textMuted, fontSize: 12, marginTop: 1, fontFamily: ZFont.medium },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'center', backgroundColor: 'rgba(212,227,200,0.6)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, marginTop: 10, marginHorizontal: 16 },
  noticeText: { flexShrink: 1, color: ZColors.forest, fontSize: 11.5, lineHeight: 16, fontFamily: ZFont.medium },
  help: { backgroundColor: 'rgba(255,212,204,0.92)', padding: 16, gap: 8, margin: 10, borderRadius: 24, borderWidth: 1, borderColor: '#FFFFFF' },
  helpTitle: { color: ZColors.textPrimary, fontSize: 15.5, fontFamily: ZFont.heavy, lineHeight: 21 },
  helpText: { color: ZColors.textSecondary, fontSize: 13, lineHeight: 19, fontFamily: ZFont.regular },
  list: { padding: 16, gap: 6, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { alignItems: 'center', gap: 6, marginTop: 30, paddingHorizontal: 24 },
  emptyText: { color: ZColors.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center', fontFamily: ZFont.medium },
  day: { alignSelf: 'center', color: ZColors.textMuted, fontSize: 11, fontFamily: ZFont.bold, letterSpacing: 0.8, textTransform: 'uppercase', marginVertical: 10, backgroundColor: 'rgba(255,255,255,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, overflow: 'hidden' },
  bubbleWrap: { maxWidth: '82%', marginTop: 4 },
  mineWrap: { alignSelf: 'flex-end', ...ZShadow.glow, shadowOpacity: 0.22 },
  theirsWrap: { alignSelf: 'flex-start' },
  bubble: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, gap: 3 },
  mineShape: { borderRadius: 20, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: 'rgba(255,255,255,0.92)', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: '#FFFFFF', ...ZShadow.subtle },
  body: { color: ZColors.textPrimary, fontSize: 15, lineHeight: 21, fontFamily: ZFont.regular },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  meta: { color: ZColors.textMuted, fontSize: 10.5, alignSelf: 'flex-end', fontFamily: ZFont.medium },
  metaMine: { color: 'rgba(255,255,255,0.8)' },
  seen: { alignSelf: 'flex-end', color: ZColors.textMuted, fontSize: 11, marginTop: -2, fontFamily: ZFont.semibold },
  error: { color: ZColors.coralDeep, fontSize: 13, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 4, fontFamily: ZFont.semibold },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  inputShell: { flex: 1, minHeight: 48, justifyContent: 'center' },
  input: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 13, fontSize: 15, maxHeight: 120, color: ZColors.textPrimary, fontFamily: ZFont.regular, ...webNoOutline },
  sendBtn: { width: 48, height: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center', ...ZShadow.glow },
});

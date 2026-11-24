import { MaterialIcons } from '@expo/vector-icons';
import { useScreenFocused } from '@/hooks/use-screen-focused';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EXPRESSION_LABEL, type MossExpression } from '@/components/moss/expressions';
import { Moss } from '@/components/moss/moss';
import { useHeldExpression } from '@/components/moss/use-held-expression';
import { VoiceHalo } from '@/components/moss/voice-halo';
import { Backdrop } from '@/components/z/backdrop';
import { PressScale, ZButton } from '@/components/z/press';
import { Clay, Frost, Gloss } from '@/components/z/surfaces';
import { ZColors, ZFont, ZGradients } from '@/constants/zindagi-theme';
import { RequireAuth } from '@/components/require-auth';
import { getAuthSession } from '@/lib/auth-session';
import { getTodayMood } from '@/lib/daily-mood';
import { deleteConversation, endConversation, issueVoiceTicket, startConversation } from '@/lib/conversation-api';
import { dismissSupportPrompt, requestSupportPromptCheck, type PromptHint } from '@/lib/support-prompt-store';
import { moodReaction, ToneTracker } from '@/lib/tone';
import { createDemoVoiceClient } from '@/lib/demo-voice-client';
import { createVoiceClient, isVoiceSupported, VOICE_UNSUPPORTED_MESSAGE } from '@/lib/voice-client';
import type { VoiceClient, VoiceEvent } from '@/lib/voice-client-types';

type Line = { id: string; role: 'user' | 'assistant' | 'system'; text: string };
type VoiceState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'checking' | 'responding' | 'ending' | 'ended';

// react-native-web keeps the Switch thumb teal unless told otherwise.
const switchWeb = { activeThumbColor: '#FFFFFF' } as object;

const BADGE: Record<VoiceState, string> = {
  idle: 'Ready', connecting: 'Connecting', listening: 'Listening', speaking: 'Listening', checking: 'Thinking',
  responding: 'Speaking', ending: 'Ending', ended: 'Ended',
};

function PulseDot() {
  const o = useSharedValue(1);
  useEffect(() => { o.value = withRepeat(withTiming(0.35, { duration: 700 }), -1, true); }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

function Bubble({ line }: { line: Line }) {
  const mine = line.role === 'user';
  return (
    <Animated.View entering={FadeInDown.springify().damping(15).stiffness(180)} style={[styles.bubbleWrap, mine ? styles.mineWrap : styles.lisaWrap]}>
      {mine
        ? <LinearGradient colors={ZGradients.gloss} style={[styles.bubble, styles.mine]}>
          <Text style={[styles.who, { color: 'rgba(255,255,255,0.7)' }]}>You</Text>
          <Text style={[styles.bubbleText, { color: '#fff' }]}>{line.text}</Text>
        </LinearGradient>
        : <View style={[styles.bubble, styles.lisa]}>
          <Text style={styles.who}>Lisa</Text>
          <Text style={styles.bubbleText}>{line.text}</Text>
        </View>}
    </Animated.View>
  );
}

export default function ProtectedVoiceScreen() {
  return <RequireAuth><VoiceScreen /></RequireAuth>;
}

function VoiceScreen() {
  const router = useRouter();
  const focused = useScreenFocused();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ moods?: string; note?: string; demo?: string }>();
  // ?demo=1 plays a scripted offline conversation (no mic, no network) for presentations and UI review.
  const demo = params.demo === '1';
  const [state, setState] = useState<VoiceState>('idle');
  const [consent, setConsent] = useState(false);
  const [memoryConsent, setMemoryConsent] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [partial, setPartial] = useState('');
  const [notice, setNotice] = useState('');
  const [summaryStatus, setSummaryStatus] = useState('');
  const [muted, setMuted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [face, setFace] = useState<MossExpression>('calm');
  const [moodLine, setMoodLine] = useState('');
  const client = useRef<VoiceClient | null>(null);
  const conversationId = useRef<string | null>(null);
  // Mirrors conversationId for rendering: refs must not be read during render.
  const [hasConversation, setHasConversation] = useState(false);
  const lineNumber = useRef(0);
  const scrollView = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tracker = useRef<ToneTracker>(new ToneTracker([]));
  const amp = useSharedValue(0);
  const speakingSV = useSharedValue(0);
  const shownFace = useHeldExpression(face, 1200);
  // A support prompt waits until Lisa has finished speaking (or a short fallback), then the root sheet fetches and shows it.
  const promptArmed = useRef(false);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the student answers Lisa's offer out loud; cleared once the sheet opens with it.
  const promptHint = useRef<PromptHint | undefined>(undefined);
  const spokenDecline = useRef(false);
  const stateRef = useRef<VoiceState>('idle');
  const mutedRef = useRef(false);
  useEffect(() => { stateRef.current = state; mutedRef.current = muted; }, [state, muted]);

  const todayMoods = () => getTodayMood(getAuthSession()?.user.id)?.moods ?? params.moods?.split(',').filter(Boolean) ?? [];

  // Before a session, Moss greets the student with today's check-in.
  useFocusEffect(useCallback(() => {
    if (stateRef.current !== 'idle') return;
    const reaction = moodReaction(todayMoods());
    setFace(reaction ? (reaction.expression === 'encouraging' ? 'calm' : reaction.expression) : 'happy');
    setMoodLine(reaction?.line ?? "Hi, I'm Moss. I'll keep Lisa company while you talk.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.moods]));

  // Voice level → animation. Polled per frame while a session is live; nothing is recorded.
  useEffect(() => {
    if (state === 'idle' || state === 'ended') { amp.value = withTiming(0, { duration: 300 }); return; }
    let raf = 0;
    const loop = () => {
      const levels = client.current?.levels() ?? { mic: 0, lisa: 0 };
      const s = stateRef.current;
      const level = s === 'responding' ? levels.lisa : mutedRef.current ? 0 : levels.mic;
      amp.value = withTiming(level, { duration: 90 });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, amp]);
  useEffect(() => { speakingSV.value = state === 'responding' ? 1 : 0; }, [state, speakingSV]);

  const showPromptSoon = (ms: number) => {
    if (promptTimer.current) clearTimeout(promptTimer.current);
    promptTimer.current = setTimeout(() => {
      promptArmed.current = false;
      const hint = promptHint.current;
      promptHint.current = undefined;
      requestSupportPromptCheck(hint);
    }, ms);
  };

  const addLine = (role: Line['role'], text: string) => {
    setLines(previous => [...previous, { id: String(++lineNumber.current), role, text }]);
  };
  const onVoiceEvent = (event: VoiceEvent) => {
    const tone = tracker.current;
    switch (event.type) {
      case 'ready': setState('listening'); setNotice('Microphone is live. Speak naturally.'); setFace(tone.resting()); break;
      case 'speech_start': setState('speaking'); setPartial(''); setFace('listening'); break;
      case 'speech_end': setState('checking'); break;
      case 'transcript_partial': {
        setPartial(event.text ?? '');
        const live = event.text ? tone.peek(event.text) : null;
        if (live) setFace(live);
        break;
      }
      case 'transcript_final': setPartial(''); if (event.text) { addLine('user', event.text); setFace(tone.hearUser(event.text)); } break;
      case 'processing':
        if (event.stage === 'lisa_generation') { setState('checking'); setFace('thinking'); }
        break;
      case 'response_text': if (event.text) { addLine('assistant', event.text); if (!event.serviceMessage) setFace(tone.hearLisa(event.text)); }
        setState(event.serviceMessage ? 'listening' : 'responding'); setNotice(''); break;
      case 'audio_start': setState('responding'); setNotice(''); break;
      case 'audio_end': setState('listening'); setNotice(''); setFace(tone.resting()); if (promptArmed.current) showPromptSoon(800); break;
      case 'support_prompt': promptArmed.current = true; spokenDecline.current = false; showPromptSoon(5000); break;
      case 'support_prompt_intent':
        if (event.intent === 'decline') {
          // "No" to Lisa: do not pop the sheet in their face; it is still there if they open the app later.
          if (event.promptId) dismissSupportPrompt(event.promptId);
          if (promptTimer.current) clearTimeout(promptTimer.current);
          promptArmed.current = false; promptHint.current = undefined; spokenDecline.current = true;
        } else if (event.intent) {
          // Lisa is about to say "check your phone": open the sheet when she finishes, already on their choice.
          promptHint.current = { intent: event.intent, contactId: event.contactId };
          promptArmed.current = true; spokenDecline.current = false; showPromptSoon(5000);
        }
        break;
      case 'interrupted': setState('speaking'); setFace('listening'); setNotice('Lisa stopped speaking so you can continue.'); break;
      case 'risk':
        tone.setRisk(event.level);
        if (tone.risk !== 'LOW') setFace(tone.risk === 'URGENT' ? 'steady' : 'concerned');
        // LOW verdicts can arrive after Lisa already started speaking, so they never change the UI state.
        if (event.level === 'URGENT' || event.level === 'UNKNOWN' || event.level === 'ELEVATED') {
          if (!event.provisional) setState('responding');
          setNotice('Lisa is checking your safety before continuing.');
        }
        break;
      case 'error': setNotice(`Voice error: ${event.code ?? 'unknown'}`);
        if (event.code === 'generation_failed' || event.code === 'response_blocked' || event.code === 'turn_internal_error')
          setState('listening');
        break;
      case 'session_end': if (promptTimer.current) clearTimeout(promptTimer.current); promptArmed.current = false; if (!spokenDecline.current) requestSupportPromptCheck(promptHint.current); setState('ended'); setNotice(''); setSummaryStatus(event.summaryStatus ?? 'none'); setFace(tone.ended()); client.current = null; break;
    }
  };

  const start = async () => {
    if (demo) {
      tracker.current = new ToneTracker(todayMoods().length ? todayMoods() : ['anxious', 'overwhelmed']);
      setState('connecting'); setNotice(''); setSummaryStatus('');
      const voice = createDemoVoiceClient({ onEvent: onVoiceEvent, onError: message => setNotice(message) });
      client.current = voice;
      await voice.start('demo');
      return;
    }
    // Checked before a conversation is created on the server, so Expo Go never leaves an orphaned session behind.
    if (!isVoiceSupported()) { setNotice(VOICE_UNSUPPORTED_MESSAGE); return; }
    const token = getAuthSession()?.session.token;
    if (!token) { router.push('/login'); return; }
    setState('connecting'); setNotice('Requesting microphone access and connecting…');
    setSummaryStatus('');
    try {
      // Every conversation carries today's mood, whether or not the student just passed through the check-in screen.
      const today = getTodayMood(getAuthSession()?.user.id);
      const moods = today?.moods ?? params.moods?.split(',').filter(Boolean) ?? [];
      tracker.current = new ToneTracker(moods);
      const created = await startConversation(token, moods, today?.note || params.note, consent, memoryConsent);
      conversationId.current = created.id;
      setHasConversation(true);
      const { ticket } = await issueVoiceTicket(token, created.id);
      const voice = createVoiceClient({ onEvent: onVoiceEvent, onError: message => setNotice(message) });
      client.current = voice;
      await voice.start(ticket);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not start voice session.');
      if (conversationId.current) await endConversation(token, conversationId.current).catch(() => {});
      conversationId.current = null;
      setHasConversation(false);
      client.current?.end(); client.current = null;
      setState('idle');
    }
  };
  const end = () => {
    setState('ending');
    setNotice('Ending the session…');
    client.current?.end();
    if (!client.current) setState('ended');
  };
  // Tab screens stay mounted, so leaving the "ended" screen must clear it or the next visit still shows "Session ended".
  const reset = () => {
    client.current?.end(); client.current = null;
    conversationId.current = null;
    setHasConversation(false);
    lineNumber.current = 0;
    setState('idle'); setLines([]); setPartial(''); setNotice(''); setSummaryStatus('');
    setMuted(false); setConfirmDelete(false); setDeleting(false);
  };
  const toggleMute = () => {
    const value = !muted;
    setMuted(value); client.current?.mute(value);
  };
  const removeSavedSession = async () => {
    const token = getAuthSession()?.session.token;
    const id = conversationId.current;
    if (!token || !id) return;
    setDeleting(true);
    try {
      await deleteConversation(token, id);
      conversationId.current = null;
      setHasConversation(false);
      setSummaryStatus('none');
      setNotice('Saved session data was deleted.');
      setConfirmDelete(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete session data.');
    } finally { setDeleting(false); }
  };
  useEffect(() => () => { client.current?.end(); if (promptTimer.current) clearTimeout(promptTimer.current); }, []);
  useEffect(() => { setTimeout(() => scrollView.current?.scrollToEnd({ animated: true }), 60); }, [lines, partial]);

  const live = state !== 'idle' && state !== 'ended';
  const moss = Math.min(176, Math.round(width * 0.44));
  const halo = Math.round(moss * 1.34);
  const statusText = state === 'connecting' ? 'Connecting…' :
    state === 'speaking' ? 'Listening to you…' : state === 'responding' ? 'Lisa is speaking' :
      state === 'checking' ? 'Lisa is thinking…' :
        state === 'ending' ? 'Ending…' : muted ? 'Microphone muted' : 'Listening';

  return <View style={styles.root}>
    <Backdrop />
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Lisa</Text>
        <View style={styles.headerRight}>
          <PressScale onPress={() => router.push('/trusted-contacts' as Href)} accessibilityLabel="People I trust" accessibilityRole="button">
            <Frost radius={99} style={styles.trust}>
              <View style={styles.trustInner}>
                <MaterialIcons name="favorite" size={14} color={ZColors.coralDeep} />
                <Text style={styles.trustText}>People I trust</Text>
              </View>
            </Frost>
          </PressScale>
          <Gloss radius={99} style={styles.badge}>
            <View style={styles.badgeInner}>
              {live && <PulseDot />}
              <Text style={styles.badgeText}>{BADGE[state]}</Text>
            </View>
          </Gloss>
        </View>
      </View>

      {state === 'idle' ? <ScrollView contentContainerStyle={styles.startArea} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeIn.duration(500)} style={styles.heroMoss}>
          <Moss expression={shownFace} size={Math.min(210, width * 0.52)} active={focused} />
        </Animated.View>
        <Frost tint="sage" radius={16} style={styles.say}><Text style={styles.sayText}>{moodLine}</Text></Frost>
        <Text style={styles.heading}>A space to talk</Text>
        <Text style={styles.body}>Lisa is an AI support companion. Her responses are checked before playback, but this prototype is not emergency or clinical care.</Text>
        <Clay radius={22} style={styles.consentCard}>
          <View style={styles.consentRow}>
            <Text style={styles.consentText}>Save transcript and summary for future sessions (30 days)</Text>
            <Switch value={consent} onValueChange={setConsent} trackColor={{ true: ZColors.olive, false: ZColors.creamDark }} thumbColor="#fff" {...switchWeb} />
          </View>
          <View style={styles.divider} />
          <View style={styles.consentRow}>
            <Text style={styles.consentText}>Lisa remembers a short summary of our chats to support you better (no transcript is kept)</Text>
            <Switch value={memoryConsent} onValueChange={setMemoryConsent} trackColor={{ true: ZColors.olive, false: ZColors.creamDark }} thumbColor="#fff" {...switchWeb} />
          </View>
        </Clay>
        <ZButton label="Start hands-free session" icon="graphic-eq" onPress={start} style={styles.startBtn} />
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {/* <Text style={styles.disclosure}>Live audio is processed by Deepgram for transcription and Sarvam for speech. The app does not save audio. Provider retention may differ.</Text>
        <Text style={styles.disclosure}>Without transcript consent, the temporary session record expires within 24 hours. Saved transcripts and summaries expire after 30 days and can be deleted after the session.</Text> */}
      </ScrollView> : state === 'ended' ? <ScrollView contentContainerStyle={[styles.startArea, { justifyContent: 'center', flexGrow: 1 }]}>
        <Moss expression={shownFace} size={Math.min(200, width * 0.5)} active={focused} />
        <Text style={styles.heading}>Session ended</Text>
        <Text style={styles.body}>{summaryStatus === 'pending' ? 'Your summary is being prepared.' :
          summaryStatus === 'completed' ? 'Your summary is ready in Saved.' :
            summaryStatus === 'none' ? 'No transcript or summary was saved.' :
              'Summary status is unavailable. Check history later.'}</Text>
        <ZButton label="Done" icon="check" onPress={() => { reset(); router.replace('/mood-checkin'); }} style={styles.startBtn} />
        {consent && <ZButton variant="ghost" label="View saved sessions and summary status" onPress={() => { reset(); router.replace('/saved' as Href); }} />}
        {consent && hasConversation && <ZButton variant="clay" compact disabled={deleting}
          label={deleting ? 'Deleting…' : confirmDelete ? 'Confirm delete saved session' : 'Delete saved session data'}
          icon="delete-outline" onPress={() => confirmDelete ? void removeSavedSession() : setConfirmDelete(true)} />}
        {confirmDelete && !deleting && <ZButton variant="ghost" label="Cancel deletion" onPress={() => setConfirmDelete(false)} />}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
      </ScrollView> : <>
        <ScrollView ref={scrollView} style={styles.feedScroll} contentContainerStyle={[styles.feed, { paddingBottom: halo * 0.42 + 12 }]} showsVerticalScrollIndicator={false}>
          {lines.length === 0 && !partial && <Animated.Text entering={FadeIn.delay(300)} style={styles.feedHint}>Say hi whenever you&apos;re ready. Lisa can hear you.</Animated.Text>}
          {lines.map(line => <Bubble key={line.id} line={line} />)}
          {!!partial && <View style={[styles.bubbleWrap, styles.mineWrap]}>
            <View style={[styles.bubble, styles.mine, styles.partial]}>
              <Text style={[styles.bubbleText, { color: ZColors.forest, fontFamily: ZFont.medium }]}>{partial}…</Text>
            </View>
          </View>}
        </ScrollView>
        <Clay radius={34} style={[styles.sheet, { paddingTop: moss * 0.8 }]}>
          <View style={[styles.mossWrap, { top: -moss * 0.36, width: halo, height: halo, marginLeft: -halo / 2 }]} pointerEvents="none">
            <VoiceHalo size={halo} amp={amp} expression={shownFace} thinking={state === 'checking'} active={focused} style={StyleSheet.absoluteFill} />
            <Moss expression={shownFace} size={moss} amp={amp} speaking={speakingSV} active={focused}
              style={{ position: 'absolute', left: (halo - moss) / 2, top: (halo - moss) / 2 }} />
          </View>
          <Text style={styles.status} accessibilityLiveRegion="polite">{statusText}</Text>
          <View style={styles.feelRow}>
            <View style={styles.feelDot} />
            <Text style={styles.feelText}>Moss: {EXPRESSION_LABEL[shownFace]}</Text>
          </View>
          {!!notice && <Text style={styles.notice}>{notice}</Text>}
          <View style={styles.buttons}>
            <ZButton variant="clay" compact icon={muted ? 'mic' : 'mic-off'} label={muted ? 'Unmute' : 'Mute'} onPress={toggleMute} disabled={state === 'ending'} style={styles.flexBtn} />
            <ZButton variant="clay" compact icon="call-end" label={state === 'ending' ? 'Ending…' : 'End session'} onPress={end} disabled={state === 'ending'} style={styles.flexBtn} />
          </View>
          <Text style={styles.support}>If you are in immediate danger, contact local emergency services or a trusted person nearby.</Text>
        </Clay>
      </>}
      {state === 'connecting' && <ActivityIndicator color={ZColors.olive} style={styles.spinner} />}
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ZColors.canvas },
  safe: { flex: 1 },
  header: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: ZColors.ink, fontSize: 28, fontFamily: ZFont.display, letterSpacing: -0.8 },
  trust: { },
  trustInner: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 8 },
  trustText: { color: ZColors.forest, fontSize: 12.5, fontFamily: ZFont.bold },
  badge: { },
  badgeInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  badgeText: { color: '#fff', fontSize: 12.5, fontFamily: ZFont.bold },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D9F2B8' },

  startArea: { padding: 22, paddingTop: 4, alignItems: 'center', gap: 14, paddingBottom: 40 },
  heroMoss: { alignItems: 'center', marginBottom: -6 },
  say: { maxWidth: 300 },
  sayText: { color: ZColors.forest, fontFamily: ZFont.semibold, fontSize: 13.5, textAlign: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  heading: { color: ZColors.ink, fontSize: 30, fontFamily: ZFont.display, letterSpacing: -0.8, textAlign: 'center', marginTop: 6 },
  body: { color: ZColors.textSecondary, fontSize: 15, lineHeight: 23, textAlign: 'center', fontFamily: ZFont.regular, maxWidth: 360 },
  disclosure: { color: ZColors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', fontFamily: ZFont.regular, maxWidth: 360 },
  consentCard: { alignSelf: 'stretch', paddingHorizontal: 16, paddingVertical: 6 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  consentText: { flex: 1, color: ZColors.textPrimary, fontSize: 13.5, lineHeight: 19, fontFamily: ZFont.medium },
  divider: { height: 1, backgroundColor: ZColors.hairline },
  startBtn: { alignSelf: 'stretch', marginTop: 4 },
  notice: { color: '#8A5A2E', textAlign: 'center', fontSize: 12.5, fontFamily: ZFont.medium },

  feedScroll: { flex: 1 },
  feed: { paddingHorizontal: 16, paddingTop: 8, gap: 10, flexGrow: 1, justifyContent: 'flex-end' },
  feedHint: { color: ZColors.textMuted, fontFamily: ZFont.medium, fontSize: 13.5, textAlign: 'center', marginBottom: 12 },
  bubbleWrap: { maxWidth: '86%' },
  mineWrap: { alignSelf: 'flex-end' },
  lisaWrap: { alignSelf: 'flex-start' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  mine: { borderBottomRightRadius: 6 },
  // Plain translucent fill instead of a blur per bubble: many live blurs would cost frames on long chats.
  lisa: { borderBottomLeftRadius: 6, backgroundColor: 'rgba(255,255,255,0.84)', borderWidth: 1, borderColor: '#FFFFFF', shadowColor: '#2D4A1E', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  partial: { backgroundColor: 'rgba(212,227,200,0.65)', borderWidth: 1, borderColor: 'rgba(143,170,130,0.4)', borderStyle: 'dashed' },
  who: { color: ZColors.textMuted, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: ZFont.bold, marginBottom: 2 },
  bubbleText: { color: ZColors.textPrimary, fontSize: 15, lineHeight: 21.5, fontFamily: ZFont.regular },

  sheet: { marginHorizontal: 10, marginBottom: 10, paddingHorizontal: 16, paddingBottom: 14, alignItems: 'center', gap: 6 },
  mossWrap: { position: 'absolute', left: '50%' },
  status: { color: ZColors.ink, fontSize: 16, fontFamily: ZFont.heavy, marginTop: 4 },
  feelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(212,227,200,0.55)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  feelDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ZColors.olive },
  feelText: { color: ZColors.forest, fontFamily: ZFont.semibold, fontSize: 11.5 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 8, alignSelf: 'stretch' },
  flexBtn: { flex: 1 },
  support: { color: ZColors.textMuted, fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: 6, fontFamily: ZFont.regular, maxWidth: 300 },
  spinner: { position: 'absolute', top: '50%', alignSelf: 'center' },
});

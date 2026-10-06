import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ZColors } from '@/constants/zindagi-theme';
import { getAuthSession } from '@/lib/auth-session';
import { deleteConversation, endConversation, issueVoiceTicket, startConversation } from '@/lib/conversation-api';
import { createVoiceClient } from '@/lib/voice-client';
import type { VoiceClient, VoiceEvent } from '@/lib/voice-client-types';

type Line = { id: string; role: 'user' | 'assistant' | 'system'; text: string };

export default function VoiceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ moods?: string; note?: string }>();
  const [state, setState] = useState<'idle' | 'connecting' | 'listening' | 'speaking' | 'responding' | 'ending' | 'ended'>('idle');
  const [consent, setConsent] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [partial, setPartial] = useState('');
  const [notice, setNotice] = useState('');
  const [summaryStatus, setSummaryStatus] = useState('');
  const [muted, setMuted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const client = useRef<VoiceClient | null>(null);
  const conversationId = useRef<string | null>(null);
  const lineNumber = useRef(0);
  const scrollView = useRef<ScrollView>(null);

  const addLine = (role: Line['role'], text: string) => {
    setLines(previous => [...previous, { id: String(++lineNumber.current), role, text }]);
  };
  const onVoiceEvent = (event: VoiceEvent) => {
    switch (event.type) {
      case 'ready': setState('listening'); setNotice('Microphone is live. Speak naturally.'); break;
      case 'speech_start': setState('speaking'); setPartial(''); break;
      case 'speech_end': setState('responding'); break;
      case 'transcript_partial': setPartial(event.text ?? ''); break;
      case 'transcript_final': setPartial(''); if (event.text) addLine('user', event.text); break;
      case 'response_text': if (event.text) addLine('assistant', event.text); setState('responding'); break;
      case 'audio_start': setState('responding'); break;
      case 'audio_end': setState('listening'); break;
      case 'interrupted': setState('speaking'); setNotice('Lisa stopped speaking so you can continue.'); break;
      case 'risk': if (event.level === 'URGENT' || event.level === 'UNKNOWN') setNotice('Lisa is checking your safety before continuing.'); break;
      case 'error': setNotice(`Voice error: ${event.code ?? 'unknown'}`); break;
      case 'session_end': setState('ended'); setSummaryStatus(event.summaryStatus ?? 'none'); client.current = null; break;
    }
  };

  const start = async () => {
    const token = getAuthSession()?.session.token;
    if (!token) { router.push('/login'); return; }
    setState('connecting'); setNotice('Requesting microphone access and connecting...');
    setSummaryStatus('');
    try {
      const created = await startConversation(token, params.moods?.split(',') ?? [], params.note, consent);
      conversationId.current = created.id;
      const { ticket } = await issueVoiceTicket(token, created.id);
      const voice = createVoiceClient({ onEvent: onVoiceEvent, onError: message => setNotice(message) });
      client.current = voice;
      await voice.start(ticket);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not start voice session.');
      if (conversationId.current) await endConversation(token, conversationId.current).catch(() => {});
      conversationId.current = null;
      client.current?.end(); client.current = null;
      setState('idle');
    }
  };
  const end = () => {
    setState('ending');
    setNotice('Ending the session...');
    client.current?.end();
    if (!client.current) setState('ended');
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
      setSummaryStatus('none');
      setNotice('Saved session data was deleted.');
      setConfirmDelete(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete session data.');
    } finally { setDeleting(false); }
  };
  useEffect(() => () => client.current?.end(), []);
  useEffect(() => scrollView.current?.scrollToEnd({ animated: true }), [lines, partial]);

  return <View style={styles.root}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Lisa</Text>
        <Text style={styles.badge}>{state === 'idle' ? 'Ready' : state}</Text>
      </View>
      {state === 'idle' ? <View style={styles.startArea}>
        <MaterialIcons name="spa" size={56} color={ZColors.sage} />
        <Text style={styles.heading}>A space to talk</Text>
        <Text style={styles.body}>Lisa is an AI support companion. Her responses are checked before playback, but this prototype is not emergency or clinical care.</Text>
        <Text style={styles.disclosure}>Live audio is processed by Deepgram for transcription and Sarvam for speech. The app does not save audio. Provider retention may differ.</Text>
        <Text style={styles.disclosure}>Without transcript consent, the temporary session record expires within 24 hours. Saved transcripts and summaries expire after 30 days and can be deleted after the session.</Text>
        <View style={styles.consentRow}>
          <Text style={styles.consentText}>Save transcript and summary for future sessions (30 days)</Text>
          <Switch value={consent} onValueChange={setConsent} />
        </View>
        <TouchableOpacity style={styles.primary} onPress={start}>
          <Text style={styles.primaryText}>Start hands-free session</Text>
        </TouchableOpacity>
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
      </View> : state === 'ended' ? <View style={styles.startArea}>
        <Text style={styles.heading}>Session ended</Text>
        <Text style={styles.body}>{summaryStatus === 'pending' ? 'Your summary is being prepared.' :
          summaryStatus === 'completed' ? 'Your summary is ready in Saved.' :
          summaryStatus === 'none' ? 'No transcript or summary was saved.' :
          'Summary status is unavailable. Check history later.'}</Text>
        <TouchableOpacity style={styles.primary} onPress={() => router.replace('/mood-checkin')}>
          <Text style={styles.primaryText}>Done</Text>
        </TouchableOpacity>
        {consent && <TouchableOpacity onPress={() => router.replace('/saved' as Href)}>
          <Text style={styles.notice}>View saved sessions and summary status</Text>
        </TouchableOpacity>}
        {consent && conversationId.current && <TouchableOpacity style={styles.secondary} disabled={deleting}
          onPress={() => confirmDelete ? void removeSavedSession() : setConfirmDelete(true)}>
          <Text style={styles.secondaryText}>{deleting ? 'Deleting...' : confirmDelete ? 'Confirm delete saved session' : 'Delete saved session data'}</Text>
        </TouchableOpacity>}
        {confirmDelete && !deleting && <TouchableOpacity onPress={() => setConfirmDelete(false)}>
          <Text style={styles.notice}>Cancel deletion</Text>
        </TouchableOpacity>}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
      </View> : <>
        <ScrollView ref={scrollView} contentContainerStyle={styles.chat}>
          {lines.map(line => <View key={line.id} style={[styles.bubble, line.role === 'user' ? styles.userBubble : styles.lisaBubble]}>
            <Text style={styles.label}>{line.role === 'user' ? 'You' : 'Lisa'}</Text>
            <Text style={styles.bubbleText}>{line.text}</Text>
          </View>)}
          {!!partial && <Text style={styles.partial}>{partial}</Text>}
        </ScrollView>
        <View style={styles.controls}>
          <MaterialIcons name={state === 'speaking' ? 'graphic-eq' : 'mic'} size={44} color={muted ? '#777' : ZColors.sage} />
          <Text style={styles.status}>{state === 'connecting' ? 'Connecting...' :
            state === 'speaking' ? 'Listening to you...' : state === 'responding' ? 'Lisa is responding...' :
            state === 'ending' ? 'Ending...' : muted ? 'Microphone muted' : 'Listening'}</Text>
          {!!notice && <Text style={styles.notice}>{notice}</Text>}
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.secondary} onPress={toggleMute} disabled={state === 'ending'}>
              <Text style={styles.secondaryText}>{muted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={end} disabled={state === 'ending'}>
              <Text style={styles.secondaryText}>{state === 'ending' ? 'Ending...' : 'End session'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.support}>If you are in immediate danger, contact local emergency services or a trusted person nearby.</Text>
        </View>
      </>}
      {state === 'connecting' && <ActivityIndicator color={ZColors.sage} style={styles.spinner} />}
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ZColors.dark },
  safe: { flex: 1 },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#fff', fontSize: 25, fontWeight: '700' },
  badge: { color: '#fff', backgroundColor: ZColors.olive, overflow: 'hidden', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5, textTransform: 'capitalize' },
  startArea: { flex: 1, padding: 28, justifyContent: 'center', alignItems: 'center', gap: 16 },
  heading: { color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  body: { color: 'rgba(255,255,255,0.8)', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  disclosure: { color: 'rgba(255,255,255,0.62)', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: ZColors.darkCard, borderRadius: 12 },
  consentText: { flex: 1, color: '#fff', fontSize: 14 },
  primary: { backgroundColor: ZColors.olive, borderRadius: 28, paddingHorizontal: 28, paddingVertical: 16, marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  notice: { color: '#f0c9a8', textAlign: 'center', fontSize: 13, marginTop: 6 },
  chat: { padding: 20, paddingBottom: 32 },
  bubble: { maxWidth: '85%', padding: 14, borderRadius: 15, marginBottom: 12 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: ZColors.olive },
  lisaBubble: { alignSelf: 'flex-start', backgroundColor: ZColors.darkCard },
  label: { color: 'rgba(255,255,255,0.55)', fontSize: 11, marginBottom: 5 },
  bubbleText: { color: '#fff', fontSize: 15, lineHeight: 22 },
  partial: { color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' },
  controls: { alignItems: 'center', padding: 20, gap: 8 },
  status: { color: '#fff', fontSize: 15 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  secondary: { backgroundColor: ZColors.darkCard, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 22 },
  secondaryText: { color: '#fff', fontWeight: '600' },
  support: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', marginTop: 8 },
  spinner: { position: 'absolute', top: '50%', alignSelf: 'center' },
});

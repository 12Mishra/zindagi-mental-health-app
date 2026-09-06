import { MaterialIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZRadius } from '@/constants/zindagi-theme';
import { getAuthSession } from '@/lib/auth-session';
import { startConversation, sendMessage, endConversation, transcribeAudio } from '@/lib/conversation-api';

// ── Breathing Animation Logic (retained but smaller) ─────────────

type PhaseKey = 'inhale' | 'hold1' | 'exhale' | 'hold2';
const PHASES: { key: PhaseKey; label: string; duration: number; scale: number; glow: number }[] = [
  { key: 'inhale', label: 'Breathe in...', duration: 4, scale: 1.0, glow: 0.9 },
  { key: 'hold1', label: 'Hold...', duration: 4, scale: 1.0, glow: 0.7 },
  { key: 'exhale', label: 'Breathe out...', duration: 4, scale: 0.68, glow: 0.2 },
  { key: 'hold2', label: 'Hold...', duration: 4, scale: 0.68, glow: 0.12 },
];
const PHASE_COLORS: Record<PhaseKey, string> = {
  inhale: 'rgba(255,255,255,0.92)',
  hold1: 'rgba(255,255,255,0.75)',
  exhale: 'rgba(255,255,255,0.55)',
  hold2: 'rgba(255,255,255,0.38)',
};

// ── Components ────────────────────────────────────────

function MessageBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const isUser = role === 'user';
  return (
    <View style={[bubbleStyles.container, isUser ? bubbleStyles.userContainer : bubbleStyles.lisaContainer]}>
      {!isUser && <Text style={bubbleStyles.label}>Lisa</Text>}
      <View style={[bubbleStyles.bubble, isUser ? bubbleStyles.userBubble : bubbleStyles.lisaBubble]}>
        <Text style={[bubbleStyles.text, isUser ? bubbleStyles.userText : bubbleStyles.lisaText]}>
          {content}
        </Text>
      </View>
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────

export default function VoiceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ moods?: string; note?: string }>();
  
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<{ summary: string; keyThemes: string[] } | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [textInput, setTextInput] = useState('');
  const [isEnding, setIsEnding] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const selectedVoiceRef = useRef<any>(null);
  const auth = getAuthSession();
  
  // Breathing animation states
  const [phaseIdx, setPhaseIdx] = useState(0);
  const phaseRef = useRef(0);
  const scale = useSharedValue(0.68);
  const glowOpacity = useSharedValue(0.12);

  // Auto-scroll
  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const pickFemaleVoice = (): any => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const vs = window.speechSynthesis.getVoices();
    if (!vs || vs.length === 0) return null;

    const isMale = (name: string) => {
      const n = name.toLowerCase();
      const maleNames = ['david', 'mark', 'george', 'guy', 'ryan', 'christopher', 'prabhat', 'ravi', 'hemant', 'sean', 'james', 'richard', 'paul', 'brian', 'stefan', 'michael', 'charles', 'thomas', 'daniel', 'matthew', 'male'];
      return maleNames.some(m => n.includes(m)) && !n.includes('female');
    };

    // Priority 1: Confirmed female voices on Windows (Zira), Chrome (Google US English), Edge (Jenny/Aria)
    const confirmedFemale = vs.find(v => {
      const n = v.name.toLowerCase();
      return !isMale(n) && (
        n.includes('female') ||
        n.includes('woman') ||
        n.includes('zira') ||
        n.includes('google us english') ||
        n.includes('google uk english female') ||
        n.includes('jenny') ||
        n.includes('aria') ||
        n.includes('sonia') ||
        n.includes('neerja') ||
        n.includes('samantha') ||
        n.includes('victoria') ||
        n.includes('karen')
      );
    });
    if (confirmedFemale) return confirmedFemale;

    // Priority 2: Any English voice that is not in the male list
    const anyFemale = vs.find(v => !isMale(v.name) && v.lang.toLowerCase().startsWith('en'));
    return anyFemale || null;
  };

  const getOrLoadFemaleVoice = async (): Promise<any> => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    let voice = pickFemaleVoice();
    if (voice) return voice;

    // Wait for browser to asynchronously populate voices
    await new Promise<void>((resolve) => {
      let timeoutId: any;
      const handler = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', handler);
        clearTimeout(timeoutId);
        resolve();
      };
      window.speechSynthesis.addEventListener('voiceschanged', handler);
      timeoutId = setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', handler);
        resolve();
      }, 500);
    });

    return pickFemaleVoice();
  };

  // Pre-load female voices and clean up on unmount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      getOrLoadFemaleVoice().then(v => {
        if (v) selectedVoiceRef.current = v;
      });
      window.speechSynthesis.onvoiceschanged = () => {
        const v = pickFemaleVoice();
        if (v) selectedVoiceRef.current = v;
      };
    }

    return () => {
      Speech.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Breathing loop
  useEffect(() => {
    if (!isSessionActive) return;
    
    const animateToPhase = (idx: number) => {
      const phase = PHASES[idx];
      const dur = phase.duration * 1000;
      scale.value = withTiming(phase.scale, { duration: dur, easing: Easing.inOut(Easing.sin) });
      glowOpacity.value = withTiming(phase.glow, { duration: dur });
    };
    
    animateToPhase(phaseRef.current);
    
    const timeout = setTimeout(() => {
      const nextIdx = (phaseRef.current + 1) % PHASES.length;
      phaseRef.current = nextIdx;
      setPhaseIdx(nextIdx);
    }, PHASES[phaseRef.current].duration * 1000);
    
    return () => clearTimeout(timeout);
  }, [isSessionActive, phaseIdx]);

  const currentPhase = PHASES[phaseIdx];
  const ringColor = isSessionActive ? PHASE_COLORS[currentPhase.key] : 'rgba(255,255,255,0.3)';
  
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value }));

  const speakVoice = async (text: string) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.96; // exact rate requested by user
      utterance.pitch = 1.15; // sweet, warm feminine resonance

      const v = await getOrLoadFemaleVoice();
      if (v) {
        utterance.voice = v;
        selectedVoiceRef.current = v;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    } else {
      Speech.speak(text, {
        language: 'en-US',
        rate: 0.96,
        pitch: 1.15,
        onStart: () => setIsSpeaking(true),
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
      });
    }
  };

  // API calls
  const handleStartSession = async () => {
    const currentSession = getAuthSession();
    if (!currentSession?.session.token) {
      router.push('/login');
      return;
    }
    try {
      setIsProcessing(true);
      const moodsArray = params.moods ? params.moods.split(',') : [];
      const { id } = await startConversation(currentSession.session.token, moodsArray, params.note);
      setConversationId(id);
      setIsSessionActive(true);
      
      // Initial message
      const greeting = 'Hi there. I am Lisa. I am here to listen. How are you feeling right now?';
      setMessages([{ role: 'assistant', content: greeting }]);
      speakVoice(greeting);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendText = async () => {
    if (!textInput.trim() || isProcessing || !conversationId) return;
    const currentText = textInput.trim();
    setTextInput('');
    setIsProcessing(true);
    setMessages(prev => [...prev, { role: 'user', content: currentText }]);
    try {
      const currentSession = getAuthSession();
      if (!currentSession?.session.token) return;
      const { response } = await sendMessage(currentSession.session.token, conversationId, currentText);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
      speakVoice(response);
    } catch (err) {
      console.error('Send message failed', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWebSpeech = () => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const rec = new SpeechRec();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.onstart = () => setIsRecording(true);
      rec.onend = () => setIsRecording(false);
      rec.onerror = () => setIsRecording(false);
      rec.onresult = async (e: any) => {
        const transcript = e.results[0]?.[0]?.transcript;
        if (transcript && conversationId) {
          setIsProcessing(true);
          setMessages(prev => [...prev, { role: 'user', content: transcript }]);
          try {
            const currentSession = getAuthSession();
            if (!currentSession?.session.token) return;
            const { response } = await sendMessage(currentSession.session.token, conversationId, transcript);
            setMessages(prev => [...prev, { role: 'assistant', content: response }]);
            speakVoice(response);
          } catch (err) {
            console.error(err);
          } finally {
            setIsProcessing(false);
          }
        }
      };
      rec.start();
    }
  };

  const handlePressIn = async () => {
    if (!isSessionActive || isProcessing || isSpeaking) return;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) return;
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(newRecording);
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const handlePressOut = async () => {
    if (!recording) return;
    try {
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      
      const currentSession = getAuthSession();
      if (uri && currentSession?.session.token && conversationId) {
        setIsProcessing(true);
        // Transcribe
        const { text } = await transcribeAudio(currentSession.session.token, uri);
        if (!text.trim()) {
           setIsProcessing(false);
           return;
        }
        
        // Add to UI
        setMessages(prev => [...prev, { role: 'user', content: text }]);
        
        // Get Response
        const { response } = await sendMessage(currentSession.session.token, conversationId, text);
        setMessages(prev => [...prev, { role: 'assistant', content: response }]);
        
        // Speak Response
        speakVoice(response);
      }
    } catch (err) {
      console.error('Failed to stop/process recording', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEndSession = async () => {
    const currentSession = getAuthSession();
    Speech.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);

    if (!currentSession?.session.token || !conversationId) {
      setIsSessionActive(false);
      return;
    }

    try {
      setIsEnding(true);
      const data = await endConversation(currentSession.session.token, conversationId);
      setSessionSummary(data || {
        summary: 'You completed your conversation with Lisa. Taking time to express your feelings helps you process and heal.',
        keyThemes: ['Emotional Processing', 'Supportive Dialogue'],
      });
      setIsSessionActive(false);
    } catch (err) {
      console.warn('End session completed with fallback:', err);
      setSessionSummary({
        summary: 'You completed your conversation with Lisa. Taking time to express your feelings helps you process and heal.',
        keyThemes: ['Emotional Processing', 'Supportive Dialogue'],
      });
      setIsSessionActive(false);
    } finally {
      setIsEnding(false);
      setIsProcessing(false);
    }
  };

  if (sessionSummary) {
    return (
      <View style={{ flex: 1, backgroundColor: ZColors.dark }}>
        <SafeAreaView style={s.summaryContainer}>
          <Text style={s.summaryTitle}>Session Complete</Text>
          <View style={s.summaryCard}>
            <Text style={s.summaryText}>{sessionSummary.summary}</Text>
          </View>
          <Text style={s.themesTitle}>Key Themes</Text>
          <View style={s.themesContainer}>
            {sessionSummary.keyThemes.map((theme, i) => (
              <View key={i} style={s.themeChip}>
                <Text style={s.themeText}>{theme}</Text>
              </View>
            ))}
          </View>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={s.doneButton} onPress={() => router.replace('/mood-checkin')}>
            <Text style={s.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: ZColors.dark }}>
      <StatusBar style="light" backgroundColor={ZColors.dark} />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={s.header}>
          <Text style={s.title}>Lisa</Text>
          <View style={[s.statusBadge, isSessionActive && s.statusBadgeActive]}>
            <Text style={s.statusText}>{isSessionActive ? 'Active' : 'Idle'}</Text>
          </View>
        </View>

        {!isSessionActive ? (
          <View style={s.centerStart}>
            {!getAuthSession()?.session.token ? (
              <>
                <MaterialIcons name="lock-outline" size={54} color="rgba(255,255,255,0.4)" style={{ marginBottom: 16 }} />
                <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
                  Meet Lisa
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', marginBottom: 28, maxWidth: 300, lineHeight: 20 }}>
                  Your confidential, AI-powered companion. Please log in with your phone number to start your session.
                </Text>
                <TouchableOpacity style={s.startButton} onPress={() => router.push('/login')}>
                  <Text style={s.startButtonText}>Log In to Start</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <MaterialIcons name="spa" size={54} color={ZColors.sage} style={{ marginBottom: 16 }} />
                <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
                  Ready When You Are
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', marginBottom: 28, maxWidth: 300, lineHeight: 20 }}>
                  Take a slow, deep breath. Lisa is here to listen and help without judgment.
                </Text>
                <TouchableOpacity style={s.startButton} onPress={handleStartSession} disabled={isProcessing}>
                  {isProcessing ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={s.startButtonText}>Start Session</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <>
            <ScrollView 
              ref={scrollViewRef}
              contentContainerStyle={s.chatScroll}
              showsVerticalScrollIndicator={false}
            >
              {messages.map((m, i) => (
                <MessageBubble key={i} role={m.role} content={m.content} />
              ))}
              
              {isProcessing && (
                <View style={[bubbleStyles.container, bubbleStyles.lisaContainer]}>
                  <View style={[bubbleStyles.bubble, bubbleStyles.lisaBubble]}>
                    <Text style={bubbleStyles.lisaText}>Thinking...</Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Type Message Row */}
            <View style={s.inputRow}>
              <TextInput
                style={s.textInput}
                placeholder="Type your message to Lisa..."
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={textInput}
                onChangeText={setTextInput}
                onSubmitEditing={handleSendText}
                editable={!isProcessing}
              />
              <TouchableOpacity 
                style={[s.sendButton, (!textInput.trim() || isProcessing) && s.sendButtonDisabled]}
                onPress={handleSendText}
                disabled={!textInput.trim() || isProcessing}
              >
                <MaterialIcons name="send" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>

            <View style={s.interactionArea}>
              {/* Ambient Breathing */}
              <View style={s.miniRingContainer}>
                <Animated.View style={[s.miniRing, ringStyle, { borderColor: ringColor }]}>
                   <Animated.View style={[s.miniRingGlow, glowStyle, { shadowColor: ringColor }]} />
                </Animated.View>
                <Text style={s.statusHint}>
                  {isRecording ? 'Listening to your voice...' : isProcessing ? 'Thinking...' : isSpeaking ? 'Speaking...' : Platform.OS === 'web' ? 'Click mic to speak, or type above' : 'Hold mic to speak'}
                </Text>
              </View>

              {/* Mic Button */}
              <TouchableOpacity 
                activeOpacity={0.8}
                onPress={Platform.OS === 'web' ? handleWebSpeech : undefined}
                onPressIn={Platform.OS !== 'web' ? handlePressIn : undefined}
                onPressOut={Platform.OS !== 'web' ? handlePressOut : undefined}
                disabled={isProcessing || isSpeaking}
                style={[
                  s.micButton, 
                  isRecording && s.micButtonRecording,
                  (isProcessing || isSpeaking) && s.micButtonDisabled
                ]}
              >
                <MaterialIcons name="mic" size={32} color={isRecording ? '#FFF' : 'rgba(255,255,255,0.8)'} />
              </TouchableOpacity>
            </View>

            <View style={s.bottomBar}>
              <TouchableOpacity style={[s.bottomBtn, s.bottomBtnSecondary]}>
                <MaterialIcons name="phone-in-talk" size={15} color="rgba(255,255,255,0.5)" />
                <Text style={s.bottomBtnText}>Crisis Support</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[s.bottomBtn, s.bottomBtnSecondary]} 
                onPress={handleEndSession}
                disabled={isEnding}
              >
                {isEnding ? (
                  <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
                ) : (
                  <>
                    <MaterialIcons name="close" size={15} color="rgba(255,255,255,0.5)" />
                    <Text style={s.bottomBtnText}>End Session</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const bubbleStyles = StyleSheet.create({
  container: {
    marginBottom: 16,
    maxWidth: '85%',
  },
  userContainer: {
    alignSelf: 'flex-end',
  },
  lisaContainer: {
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 4,
    marginLeft: 4,
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: ZColors.olive,
    borderBottomRightRadius: 4,
  },
  lisaBubble: {
    backgroundColor: ZColors.darkCard,
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  userText: {
    color: '#FFF',
  },
  lisaText: {
    color: 'rgba(255,255,255,0.9)',
  }
});

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.88)',
  },
  statusBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeActive: {
    backgroundColor: ZColors.olive,
  },
  statusText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  centerStart: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: ZColors.olive,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 30,
  },
  startButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  chatScroll: {
    padding: 20,
    paddingBottom: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    color: '#FFF',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ZColors.olive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  interactionArea: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  miniRingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
    marginBottom: 10,
  },
  miniRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
  },
  miniRingGlow: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 10,
  },
  statusHint: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  micButtonRecording: {
    backgroundColor: ZColors.coralDeep,
    borderColor: ZColors.coralDeep,
    transform: [{ scale: 1.1 }],
  },
  micButtonDisabled: {
    opacity: 0.5,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 10,
  },
  bottomBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 100,
  },
  bottomBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  bottomBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
  // Summary
  summaryContainer: {
    flex: 1,
    padding: 24,
  },
  summaryTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 24,
    marginTop: 40,
  },
  summaryCard: {
    backgroundColor: ZColors.darkCard,
    padding: 20,
    borderRadius: 16,
    marginBottom: 32,
  },
  summaryText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    lineHeight: 24,
  },
  themesTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 16,
  },
  themesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  themeChip: {
    backgroundColor: ZColors.olive,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  themeText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
  },
  doneButton: {
    backgroundColor: ZColors.olive,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
    marginBottom: 20,
  },
  doneButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  }
});

import { MaterialIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors } from '@/constants/zindagi-theme';
import { getAuthSession } from '@/lib/auth-session';
import { sendVoiceMessage, startConversation } from '@/lib/voice-api';

// ── Phase config ──────────────────────────────────────────────────────────────

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

// ── Screen ────────────────────────────────────────────────────────────────────

export default function VoiceScreen() {
  const params = useLocalSearchParams<{ moods?: string }>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [cycles, setCycles] = useState(0);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [lastRecordingUri, setLastRecordingUri] = useState<string | null>(null);

  const phaseRef = useRef(0);

  // Animated values
  const scale = useSharedValue(0.68);
  const glowOpacity = useSharedValue(0.12);
  const outerScale = useSharedValue(0.6);
  const outerOpacity = useSharedValue(0.04);

  const animateToPhase = (idx: number) => {
    const phase = PHASES[idx];
    const dur = phase.duration * 1000;
    scale.value = withTiming(phase.scale, {
      duration: dur,
      easing: Easing.inOut(Easing.sin),
    });
    glowOpacity.value = withTiming(phase.glow, { duration: dur });
    outerScale.value = withTiming(phase.scale * 1.18, { duration: dur });
    outerOpacity.value = withTiming(phase.glow * 0.22, { duration: dur });
  };

  // Start/restart countdown when isPlaying or phase changes
  useEffect(() => {
    if (!isPlaying) return;

    animateToPhase(phaseRef.current);

    const timeout = setTimeout(() => {
      const nextIdx = (phaseRef.current + 1) % PHASES.length;
      if (nextIdx === 0) setCycles(prev => prev + 1);
      phaseRef.current = nextIdx;
      setPhaseIdx(nextIdx);
      animateToPhase(nextIdx);
    }, PHASES[phaseRef.current].duration * 1000);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, phaseIdx]);

  async function startRecording() {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        console.warn('Microphone permission was not granted');
        return false;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: nextRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );

      setRecording(nextRecording);
      setIsRecording(true);
      return true;
    } catch (err) {
      console.error('Failed to start recording', err);
      return false;
    }
  }

  async function stopRecording(): Promise<string | null> {
    if (!recording) return lastRecordingUri;

    try {
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      console.log('Recording stopped and stored at', uri);
      if (uri) setLastRecordingUri(uri);
      return uri;
    } catch (err) {
      console.error('Failed to stop recording', err);
      return null;
    } finally {
      setRecording(null);
    }
  }

  const handleStartStop = async () => {
    if (isPlaying) {
      setIsPlaying(false);
      await stopRecording();
    } else {
      const didStartRecording = await startRecording();
      if (!didStartRecording) return;

      phaseRef.current = 0;
      setPhaseIdx(0);
      setHasStarted(true);
      setIsPlaying(true);
    }
  };

  const handleReset = async () => {
    const recordingUri = await stopRecording();
    setIsPlaying(false);
    setPhaseIdx(0);
    setCycles(0);
    setHasStarted(false);
    setSessionEnded(true);
    scale.value = withTiming(0.68, { duration: 600 });
    glowOpacity.value = withTiming(0.12, { duration: 600 });
    outerScale.value = withTiming(0.6, { duration: 600 });
    outerOpacity.value = withTiming(0.04, { duration: 600 });

    // Upload recording and navigate to chat
    const audioUri = recordingUri ?? lastRecordingUri;
    if (audioUri) {
      await uploadAndNavigateToChat(audioUri);
    }
  };

  const uploadAndNavigateToChat = async (audioUri: string) => {
    const auth = getAuthSession();
    if (!auth) return;

    setIsUploading(true);
    try {
      const moods = params.moods ? JSON.parse(params.moods) : [];
      const convRes = await startConversation(auth.session.token, moods);
      await sendVoiceMessage(
        auth.session.token,
        convRes.conversationId,
        audioUri
      );

      router.push({
        pathname: '/(tabs)/chat',
        params: { conversationId: convRes.conversationId },
      });
    } catch (err) {
      console.error('Failed to upload recording:', err);
      // Still navigate to chat even if upload fails
      router.push({
        pathname: '/(tabs)/chat',
        params: { moods: params.moods ?? '[]' },
      });
    } finally {
      setIsUploading(false);
    }
  };

  const navigateToChat = () => {
    router.push({
      pathname: '/(tabs)/chat',
      params: { moods: params.moods ?? '[]' },
    });
  };

  const currentPhase = PHASES[phaseIdx];
  const ringColor = isPlaying ? PHASE_COLORS[currentPhase.key] : 'rgba(255,255,255,0.3)';

  // Animated styles
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: outerScale.value }],
    opacity: outerOpacity.value,
  }));

  return (
    <View style={{ flex: 1, backgroundColor: ZColors.dark }}>
      <StatusBar style="light" backgroundColor={ZColors.dark} />
      <SafeAreaView style={{ flex: 1 }}>
        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>Lisa</Text>
            {/* <Text style={s.subtitle}>4 · 4 · 4 · 4 technique</Text> */}
          </View>
          {cycles > 0 && (
            <View style={s.cycleBadge}>
              <Text style={s.cycleText}>{cycles} {cycles === 1 ? 'cycle' : 'cycles'}</Text>
            </View>
          )}
        </View>

        {/* ── Breathing Ring ── */}
        <View style={s.ringContainer}>
          {/* Outermost ambient halo */}
          <Animated.View style={[s.halo, outerStyle]} />

          {/* Mid halo */}
          <Animated.View style={[s.midHalo, glowStyle]} />

          {/* Main ring */}
          <Animated.View style={[s.ring, ringStyle, { borderColor: ringColor }]}>
            {/* Glow overlay */}
            <Animated.View style={[s.ringGlow, glowStyle, { shadowColor: ringColor }]} />

            {/* Content */}
            <View style={s.ringContent}>
              {isPlaying ? (
                <Text style={[s.recordingText, { color: ringColor }]}>
                  Listening safely...
                </Text>
              ) : (
                !hasStarted && <Text style={s.idleText}>Tap start{'\n'}to begin</Text>
              )}
            </View>
          </Animated.View>
        </View>

        {/* ── Phase Progress ── */}
        <View style={s.progressRow}>
          {PHASES.map((p, i) => (
            <View
              key={p.key}
              style={[
                s.progressDot,
                {
                  backgroundColor:
                    isPlaying && i === phaseIdx
                      ? 'rgba(255,255,255,0.8)'
                      : i < phaseIdx && isPlaying
                      ? 'rgba(255,255,255,0.35)'
                      : 'rgba(255,255,255,0.12)',
                  width: isPlaying && i === phaseIdx ? 24 : 8,
                },
              ]}
            />
          ))}
        </View>

        {/* ── Tip Card ── */}
        {/* {!isPlaying && (
          <View style={s.tipCard}>
            <MaterialIcons name="lightbulb-outline" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={s.tipText}>
              Focus on the ring. Inhale as it expands, exhale as it contracts.
            </Text>
          </View>
        )} */}

        {/* ── Spacer ── */}
        <View style={{ flex: 1 }} />

        {/* ── Bottom Buttons ── */}
        <View style={s.bottomBar}>
          {isUploading ? (
            <View style={[s.bottomBtn, s.bottomBtnPrimary, { opacity: 0.7 }]}>
              <MaterialIcons name="hourglass-top" size={18} color="rgba(255,255,255,0.85)" />
              <Text style={[s.bottomBtnText, { color: 'rgba(255,255,255,0.85)' }]}>
                Processing...
              </Text>
            </View>
          ) : sessionEnded ? (
            <>
              <TouchableOpacity
                style={[s.bottomBtn, s.bottomBtnSecondary]}
                activeOpacity={0.7}
                onPress={() => {}}
              >
                <MaterialIcons name="phone-in-talk" size={15} color="rgba(255,255,255,0.5)" />
                <Text style={s.bottomBtnText}>Crisis Support</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.bottomBtn, s.bottomBtnPrimary]}
                activeOpacity={0.75}
                onPress={navigateToChat}
              >
                <MaterialIcons name="chat" size={18} color="rgba(255,255,255,0.85)" />
                <Text style={[s.bottomBtnText, { color: 'rgba(255,255,255,0.85)' }]}>
                  Chat with Lisa
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.bottomBtn, s.bottomBtnSecondary]}
                activeOpacity={0.7}
                onPress={() => {
                  setSessionEnded(false);
                  setLastRecordingUri(null);
                }}
              >
                <MaterialIcons name="refresh" size={15} color="rgba(255,255,255,0.5)" />
                <Text style={s.bottomBtnText}>New Session</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[s.bottomBtn, s.bottomBtnSecondary]}
                activeOpacity={0.7}
                onPress={() => {}}
              >
                <MaterialIcons name="phone-in-talk" size={15} color="rgba(255,255,255,0.5)" />
                <Text style={s.bottomBtnText}>Crisis Support</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.bottomBtn, s.bottomBtnPrimary]}
                activeOpacity={0.75}
                onPress={handleStartStop}
              >
                <MaterialIcons
                  name={isPlaying ? 'pause' : 'play-arrow'}
                  size={18}
                  color="rgba(255,255,255,0.85)"
                />
                <Text style={[s.bottomBtnText, { color: 'rgba(255,255,255,0.85)' }]}>
                  {isRecording ? 'Pause' : 'Start'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.bottomBtn, s.bottomBtnSecondary]}
                activeOpacity={0.7}
                onPress={handleReset}
              >
                <MaterialIcons name="close" size={15} color="rgba(255,255,255,0.5)" />
                <Text style={s.bottomBtnText}>End Session</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const RING_SIZE = 220;
const HALO_SIZE = RING_SIZE * 1.45;
const MID_HALO_SIZE = RING_SIZE * 1.2;

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.88)',
    letterSpacing: -0.3,
  },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
  cycleBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  cycleText: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },

  ringContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    height: HALO_SIZE,
  },

  halo: {
    position: 'absolute',
    width: HALO_SIZE,
    height: HALO_SIZE,
    borderRadius: HALO_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },

  midHalo: {
    position: 'absolute',
    width: MID_HALO_SIZE,
    height: MID_HALO_SIZE,
    borderRadius: MID_HALO_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },

  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ringGlow: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 20,
  },

  ringContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },

  phaseText: {
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  recordingText: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  countdownText: {
    fontSize: 52,
    fontWeight: '200',
    lineHeight: 58,
  },
  idleText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    lineHeight: 22,
  },

  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 28,
  },
  progressDot: {
    height: 8,
    borderRadius: 4,
  },

  phaseLabel: {
    textAlign: 'center',
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 10,
    letterSpacing: 0.5,
  },

  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 32,
    marginTop: 32,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tipText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    lineHeight: 18,
    flex: 1,
  },

  bottomBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 8,
  },
  bottomBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 13,
    borderRadius: 100,
  },
  bottomBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bottomBtnPrimary: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  bottomBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
});

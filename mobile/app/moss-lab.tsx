import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EXPRESSION_LABEL, type MossExpression } from '@/components/moss/expressions';
import { Moss } from '@/components/moss/moss';
import { VoiceHalo } from '@/components/moss/voice-halo';
import { Backdrop } from '@/components/z/backdrop';
import { ZButton } from '@/components/z/press';
import { Clay } from '@/components/z/surfaces';
import { ZColors, ZFont } from '@/constants/zindagi-theme';
import { scoreText, ToneTracker } from '@/lib/tone';

// Demo screen for presentations and design review: every Moss expression, plus a sentence box that runs
// the real tone engine. Not linked from the student flow; open /moss-lab directly.

const ALL = Object.keys(EXPRESSION_LABEL) as MossExpression[];
const SAMPLES = [
  "I haven't slept properly and there's too much due this week.",
  'My parents keep calling about placements and I feel stressed.',
  'Okay, I think that is actually doable.',
  'Thanks, honestly I feel a bit lighter now.',
];

export default function MossLab() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [face, setFace] = useState<MossExpression>('calm');
  const [speaking, setSpeaking] = useState(false);
  const [read, setRead] = useState('');
  const amp = useSharedValue(0);
  const speak = useSharedValue(0);
  useEffect(() => {
    speak.value = speaking ? 1 : 0;
    amp.value = speaking
      ? withRepeat(withSequence(withTiming(0.8, { duration: 140 }), withTiming(0.2, { duration: 120 }), withTiming(0.6, { duration: 160 }), withTiming(0.1, { duration: 140 })), -1)
      : withTiming(0, { duration: 200 });
  }, [speaking, amp, speak]);

  const tryLine = (text: string) => {
    const tracker = new ToneTracker(['anxious']);
    const expr = tracker.hearUser(text);
    const r = scoreText(text);
    setFace(expr);
    setRead(r ? `Heard ${r.hits.map(h => `"${h}"`).join(', ')} · score ${r.score.toFixed(2)} → ${EXPRESSION_LABEL[expr]}` : 'No cue words heard → tone unchanged');
  };

  const big = Math.min(220, width * 0.55);
  return <View style={{ flex: 1 }}>
    <Backdrop />
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.h1}>Moss</Text>
        <Text style={styles.sub}>Current face: {EXPRESSION_LABEL[face]}</Text>
        <View style={{ width: big * 1.34, height: big * 1.34, alignItems: 'center', justifyContent: 'center' }}>
          <VoiceHalo size={big * 1.34} amp={amp} expression={face} thinking={face === 'thinking'} style={StyleSheet.absoluteFill} />
          <Moss expression={face} size={big} amp={amp} speaking={speak} />
        </View>
        <ZButton variant={speaking ? 'gloss' : 'clay'} compact icon="graphic-eq" label={speaking ? 'Stop lip-sync' : 'Simulate Lisa speaking'} onPress={() => setSpeaking(v => !v)} />
        <View style={styles.grid}>
          {ALL.map(name => <Pressable key={name} onPress={() => setFace(name)} style={[styles.chip, face === name && styles.chipOn]}>
            <Text style={[styles.chipText, face === name && { color: '#fff' }]}>{EXPRESSION_LABEL[name]}</Text>
          </Pressable>)}
        </View>
        <Clay radius={22} style={styles.card}>
          <Text style={styles.cardTitle}>Run the tone engine</Text>
          {SAMPLES.map(s => <Pressable key={s} onPress={() => tryLine(s)} style={styles.sample}><Text style={styles.sampleText}>“{s}”</Text></Pressable>)}
          {!!read && <Text style={styles.read}>{read}</Text>}
        </Clay>
        <View style={styles.thumbs}>
          {ALL.map(name => <Pressable key={name} onPress={() => setFace(name)} style={styles.thumb}>
            <Moss expression={name} size={96} />
            <Text style={styles.thumbText}>{EXPRESSION_LABEL[name]}</Text>
          </Pressable>)}
        </View>
        <ZButton variant="ghost" label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { padding: 20, alignItems: 'center', gap: 14, paddingBottom: 60 },
  h1: { fontFamily: ZFont.display, fontSize: 34, color: ZColors.ink, letterSpacing: -1 },
  sub: { fontFamily: ZFont.semibold, color: ZColors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.8)', borderWidth: 1, borderColor: ZColors.hairline },
  chipOn: { backgroundColor: ZColors.forest, borderColor: ZColors.forest },
  chipText: { fontFamily: ZFont.bold, fontSize: 13, color: ZColors.forest },
  card: { alignSelf: 'stretch', padding: 16, gap: 8 },
  cardTitle: { fontFamily: ZFont.heavy, fontSize: 16, color: ZColors.ink },
  sample: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(212,227,200,0.5)' },
  sampleText: { fontFamily: ZFont.medium, fontSize: 13.5, color: ZColors.textPrimary },
  read: { fontFamily: ZFont.semibold, fontSize: 12.5, color: ZColors.olive },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  thumb: { alignItems: 'center', width: 104 },
  thumbText: { fontFamily: ZFont.bold, fontSize: 12, color: ZColors.forest },
});

import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Backdrop } from '@/components/z/backdrop';
import { PressScale } from '@/components/z/press';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZFont, ZRadius, ZShadow } from '@/constants/zindagi-theme';
import { registerWithOtp } from '@/lib/auth-api';
import { setAuthSession } from '@/lib/auth-session';

const HISTORY_OPTIONS = [
  'Stress',
  'Anxiety',
  'Panic attacks',
  'Depression',
  'Sleep issues',
  'Academic pressure',
  'Relationship concerns',
  'Family conflict',
  'Substance use',
  'Self-harm thoughts',
  'Suicide attempt history',
  'Prefer not to say',
];

export default function HistoryScreen() {
  const params = useLocalSearchParams<{
    phoneNumber?: string;
    otp?: string;
    fullName?: string;
    age?: string;
    college?: string;
    sex?: string;
  }>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const toggle = (option: string) => {
    setSelected(prev => {
      const next = new Set(prev);

      if (option === 'Prefer not to say') {
        return next.has(option) ? new Set() : new Set([option]);
      }

      next.delete('Prefer not to say');
      if (next.has(option)) next.delete(option);
      else next.add(option);
      return next;
    });
  };

  const handleFinish = async () => {
    if (
      !params.phoneNumber ||
      !params.otp ||
      !params.fullName ||
      !params.age ||
      !params.college ||
      !params.sex
    ) {
      setError('Profile details are missing. Please go back and complete your profile again.');
      return;
    }

    try {
      setError('');
      setIsSubmitting(true);
      const result = await registerWithOtp({
        phoneNumber: params.phoneNumber,
        otp: params.otp,
        fullName: params.fullName,
        age: Number(params.age),
        college: params.college,
        sex: params.sex,
        history: Array.from(selected),
      });
      setAuthSession(result);
      router.replace('/(tabs)/mood-checkin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete registration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1 }}><Backdrop /><SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <PressScale onPress={() => router.back()} style={s.iconBtn}>
            <MaterialIcons name="arrow-back" size={20} color={ZColors.forest} />
          </PressScale>
          <View style={s.stepBadge}>
            <Text style={s.stepText}>Step 3 of 3</Text>
          </View>
        </View>

        <View style={[s.promptCard, ZShadow.card]}>
          <View style={s.titleRow}>
            <View style={s.iconNode}>
              <MaterialIcons name="health-and-safety" size={22} color={ZColors.forest} />
            </View>
            <Text style={s.brand}>Zindagi</Text>
          </View>
          <Text style={s.title}>Previous history</Text>
          <Text style={s.subtitle}>
            Select any experiences that apply. This helps the app route check-ins and support prompts more thoughtfully.
          </Text>
        </View>

        <View style={s.grid}>
          {HISTORY_OPTIONS.map(option => {
            const isSelected = selected.has(option);
            const isSensitive =
              option === 'Self-harm thoughts' || option === 'Suicide attempt history';
            return (
              <PressScale
                key={option}
                onPress={() => toggle(option)}
                style={[
                  s.historyBtn,
                  ZShadow.subtle,
                  isSelected && (isSensitive ? s.sensitiveSelected : s.historySelected),
                  !isSelected && isSensitive && s.sensitiveIdle,
                ]}
              >
                {isSelected && (
                  <MaterialIcons name="check" size={15} color={ZColors.cream} />
                )}
                <Text
                  style={[
                    s.historyText,
                    isSelected && s.historyTextSelected,
                    !isSelected && isSensitive && s.sensitiveText,
                  ]}
                >
                  {option}
                </Text>
              </PressScale>
            );
          })}
        </View>

        {selected.size > 0 && (
          <View style={s.hintCard}>
            <MaterialIcons name="info-outline" size={15} color={ZColors.textMuted} />
            <Text style={s.hintText}>
              {selected.size === 1
                ? '1 item selected.'
                : `${selected.size} items selected.`}{' '}
              Tap again to remove a selection.
            </Text>
          </View>
        )}

        {error ? (
          <View style={s.errorBox}>
            <MaterialIcons name="error-outline" size={15} color={ZColors.coralDeep} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <PressScale
          disabled={isSubmitting}
          onPress={handleFinish}
          style={[s.primaryBtn, { opacity: isSubmitting ? 0.45 : 1 }]}
        >
          <Text style={s.primaryText}>{isSubmitting ? 'Creating account...' : 'Finish setup'}</Text>
          <MaterialIcons name="arrow-forward" size={18} color={ZColors.cream} />
        </PressScale>

        <PressScale style={s.supportLink}>
          <MaterialIcons name="phone-in-talk" size={14} color={ZColors.coralDeep} />
          <Text style={s.supportText}>I need immediate support</Text>
        </PressScale>
      </ScrollView>
    </SafeAreaView></View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: 20, gap: 16, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.74)', borderWidth: 1, borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadge: {
    backgroundColor: ZColors.sageLight,
    borderRadius: ZRadius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  stepText: { fontSize: 11, fontFamily: ZFont.bold, color: ZColors.forest },
  promptCard: {
    backgroundColor: ZColors.sageLight,
    borderRadius: ZRadius.cardLg,
    padding: 20,
    gap: 7,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  iconNode: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(244, 244, 240, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { fontSize: 18, fontFamily: ZFont.heavy, color: ZColors.forest },
  title: { fontSize: 25, fontFamily: ZFont.heavy, color: ZColors.textPrimary, letterSpacing: -0.4 },
  subtitle: { fontFamily: ZFont.regular, fontSize: 13, color: ZColors.textSecondary, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    width: '47.5%',
    minHeight: 52,
    borderRadius: ZRadius.pill,
    backgroundColor: 'rgba(168, 184, 155, 0.3)',
    paddingHorizontal: 12,
  },
  historySelected: { backgroundColor: ZColors.olive },
  sensitiveIdle: { backgroundColor: 'rgba(255, 179, 167, 0.32)' },
  sensitiveSelected: { backgroundColor: ZColors.coralDeep },
  historyText: {
    fontSize: 13,
    fontFamily: ZFont.bold,
    color: ZColors.textSecondary,
    textAlign: 'center',
  },
  historyTextSelected: { color: ZColors.cream },
  sensitiveText: { color: ZColors.coralDeep },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    backgroundColor: 'rgba(255,255,255,0.74)', borderWidth: 1, borderColor: '#FFFFFF',
    borderRadius: ZRadius.small,
    padding: 12,
  },
  hintText: { flex: 1, fontFamily: ZFont.regular, fontSize: 12, color: ZColors.textMuted, lineHeight: 17 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: ZColors.coralLight,
    borderRadius: ZRadius.small,
    padding: 10,
  },
  errorText: { flex: 1, fontSize: 12, color: ZColors.coralDeep, fontFamily: ZFont.bold },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ZColors.olive,
    borderRadius: ZRadius.pill,
    paddingVertical: 16,
    shadowColor: ZColors.forest,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryText: { fontSize: 16, fontFamily: ZFont.bold, color: ZColors.cream },
  supportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  supportText: { fontSize: 13, fontFamily: ZFont.bold, color: ZColors.coralDeep },
});

import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZRadius, ZShadow } from '@/constants/zindagi-theme';

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
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  const handleFinish = () => {
    router.replace('/(tabs)/mood-checkin');
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" backgroundColor={ZColors.cream} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.75}>
            <MaterialIcons name="arrow-back" size={20} color={ZColors.forest} />
          </TouchableOpacity>
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
              <TouchableOpacity
                key={option}
                activeOpacity={0.75}
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
              </TouchableOpacity>
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

        <TouchableOpacity activeOpacity={0.8} onPress={handleFinish} style={s.primaryBtn}>
          <Text style={s.primaryText}>Finish setup</Text>
          <MaterialIcons name="arrow-forward" size={18} color={ZColors.cream} />
        </TouchableOpacity>

        <TouchableOpacity style={s.supportLink} activeOpacity={0.75}>
          <MaterialIcons name="phone-in-talk" size={14} color={ZColors.coralDeep} />
          <Text style={s.supportText}>I need immediate support</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ZColors.cream },
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
    backgroundColor: ZColors.creamCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadge: {
    backgroundColor: ZColors.sageLight,
    borderRadius: ZRadius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  stepText: { fontSize: 11, fontWeight: '700', color: ZColors.forest },
  promptCard: {
    backgroundColor: ZColors.sageLight,
    borderRadius: ZRadius.card,
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
  brand: { fontSize: 18, fontWeight: '800', color: ZColors.forest },
  title: { fontSize: 25, fontWeight: '800', color: ZColors.textPrimary, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: ZColors.textSecondary, lineHeight: 20 },
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
    fontWeight: '700',
    color: ZColors.textSecondary,
    textAlign: 'center',
  },
  historyTextSelected: { color: ZColors.cream },
  sensitiveText: { color: ZColors.coralDeep },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    backgroundColor: ZColors.creamCard,
    borderRadius: ZRadius.small,
    padding: 12,
  },
  hintText: { flex: 1, fontSize: 12, color: ZColors.textMuted, lineHeight: 17 },
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
  primaryText: { fontSize: 16, fontWeight: '700', color: ZColors.cream },
  supportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  supportText: { fontSize: 13, fontWeight: '700', color: ZColors.coralDeep },
});

import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZRadius, ZShadow } from '@/constants/zindagi-theme';

const SEX_OPTIONS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];

export default function ProfileDetailsScreen() {
  const params = useLocalSearchParams<{
    phoneNumber?: string;
    otp?: string;
  }>();
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [college, setCollege] = useState('');
  const [sex, setSex] = useState('');
  const [error, setError] = useState('');

  const canContinue =
    fullName.trim().length > 1 &&
    age.replace(/\D/g, '').length > 0 &&
    college.trim().length > 1 &&
    sex.length > 0;

  const handleContinue = () => {
    if (!canContinue) return;

    if (!params.phoneNumber || !params.otp) {
      setError('Phone verification is missing. Please go back and verify your number again.');
      return;
    }

    setError('');
    router.push({
      pathname: './history',
      params: {
        phoneNumber: params.phoneNumber,
        otp: params.otp,
        fullName: fullName.trim(),
        age: age.replace(/\D/g, ''),
        college: college.trim(),
        sex,
      },
    });
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" backgroundColor={ZColors.cream} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.75}>
              <MaterialIcons name="arrow-back" size={20} color={ZColors.forest} />
            </TouchableOpacity>
            <View style={s.stepBadge}>
              <Text style={s.stepText}>Step 2 of 3</Text>
            </View>
          </View>

          <View style={[s.promptCard, ZShadow.card]}>
            <Text style={s.brand}>Zindagi</Text>
            <Text style={s.title}>Complete your profile</Text>
            <Text style={s.subtitle}>
              These details help personalize check-ins and wellness prompts for your campus context.
            </Text>
          </View>

          <View style={s.formCard}>
            <Field
              label="Full name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Enter your full name"
              icon="person-outline"
            />
            <Field
              label="Age"
              value={age}
              onChangeText={setAge}
              placeholder="Enter age"
              icon="calendar-today"
              keyboardType="number-pad"
              maxLength={2}
            />
            <Field
              label="College"
              value={college}
              onChangeText={setCollege}
              placeholder="Enter college name"
              icon="school"
            />

            <View style={{ gap: 10 }}>
              <Text style={s.label}>Sex</Text>
              <View style={s.choiceGrid}>
                {SEX_OPTIONS.map(option => {
                  const selected = sex === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      onPress={() => setSex(option)}
                      activeOpacity={0.75}
                      style={[s.choice, selected && s.choiceSelected]}
                    >
                      {selected && <MaterialIcons name="check" size={14} color={ZColors.cream} />}
                      <Text style={[s.choiceText, selected && s.choiceTextSelected]}>{option}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          {error ? (
            <View style={s.errorBox}>
              <MaterialIcons name="error-outline" size={15} color={ZColors.coralDeep} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!canContinue}
            onPress={handleContinue}
            style={[s.primaryBtn, { opacity: canContinue ? 1 : 0.45 }]}
          >
            <Text style={s.primaryText}>Continue</Text>
            <MaterialIcons name="arrow-forward" size={18} color={ZColors.cream} />
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  keyboardType?: 'default' | 'number-pad';
  maxLength?: number;
};

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  keyboardType = 'default',
  maxLength,
}: FieldProps) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.inputWrap}>
        <MaterialIcons name={icon} size={18} color={ZColors.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          maxLength={maxLength}
          placeholder={placeholder}
          placeholderTextColor={ZColors.textMuted}
          style={s.input}
        />
      </View>
    </View>
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
    gap: 6,
  },
  brand: { fontSize: 18, fontWeight: '800', color: ZColors.forest },
  title: { fontSize: 25, fontWeight: '800', color: ZColors.textPrimary, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: ZColors.textSecondary, lineHeight: 20 },
  formCard: {
    backgroundColor: ZColors.creamCard,
    borderRadius: ZRadius.card,
    padding: 16,
    gap: 16,
  },
  label: { fontSize: 13, fontWeight: '700', color: ZColors.textPrimary },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: ZColors.cream,
    borderRadius: ZRadius.small,
    borderWidth: 1,
    borderColor: ZColors.creamDark,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    color: ZColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    width: '47.5%',
    minHeight: 46,
    borderRadius: ZRadius.pill,
    backgroundColor: 'rgba(168, 184, 155, 0.28)',
    paddingHorizontal: 10,
  },
  choiceSelected: { backgroundColor: ZColors.olive },
  choiceText: {
    fontSize: 13,
    fontWeight: '700',
    color: ZColors.textSecondary,
    textAlign: 'center',
  },
  choiceTextSelected: { color: ZColors.cream },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: ZColors.coralLight,
    borderRadius: ZRadius.small,
    padding: 10,
  },
  errorText: { flex: 1, fontSize: 12, color: ZColors.coralDeep, fontWeight: '700' },
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
});

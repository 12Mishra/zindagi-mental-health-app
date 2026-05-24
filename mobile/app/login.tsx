import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
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
import { ApiError, loginWithOtp, sendOtp } from '@/lib/auth-api';
import { setAuthSession } from '@/lib/auth-session';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [registrationRequired, setRegistrationRequired] = useState(true);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const otpInputRef = useRef<TextInput>(null);

  const phoneDigits = phone.replace(/\D/g, '');
  const otpDigits = otp.replace(/\D/g, '');
  const canSendOtp = phoneDigits.length >= 10;
  const canContinue = otpSent && otpDigits.length >= 4;

  useEffect(() => {
    if (!otpSent) return;

    const focusTimer = setTimeout(() => {
      otpInputRef.current?.focus();
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 250);

    const scrollTimer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 650);

    return () => {
      clearTimeout(focusTimer);
      clearTimeout(scrollTimer);
    };
  }, [otpSent]);

  const handleSendOtp = async () => {
    if (!canSendOtp) return;
    Keyboard.dismiss();

    try {
      setError('');
      setIsSendingOtp(true);
      const result = await sendOtp(`+91${phoneDigits}`);
      setRegistrationRequired(result.registrationRequired);
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleContinue = async () => {
    if (!canContinue) return;

    if (registrationRequired) {
      router.push({
        pathname: './profile-details',
        params: {
          phoneNumber: `+91${phoneDigits}`,
          otp: otpDigits,
        },
      });
      return;
    }

    try {
      setError('');
      setIsContinuing(true);
      const result = await loginWithOtp(`+91${phoneDigits}`, otpDigits);
      setAuthSession(result);
      router.replace('/(tabs)/mood-checkin');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        router.push({
          pathname: './profile-details',
          params: {
            phoneNumber: `+91${phoneDigits}`,
            otp: otpDigits,
          },
        });
        return;
      }

      setError(err instanceof Error ? err.message : 'Failed to verify OTP.');
    } finally {
      setIsContinuing(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" backgroundColor={ZColors.cream} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scroll}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.header}>
            <Text style={s.brand}>Zindagi</Text>
            <View style={s.stepBadge}>
              <Text style={s.stepText}>Step 1 of 3</Text>
            </View>
          </View>

          <View style={[s.promptCard, ZShadow.card]}>
            <View style={s.iconNode}>
              <MaterialIcons name="phone-iphone" size={24} color={ZColors.forest} />
            </View>
            <Text style={s.title}>Login with your phone</Text>
            <Text style={s.subtitle}>
              Enter your mobile number. We will send a one-time password to verify your access.
            </Text>
          </View>

          <View style={s.formCard}>
            <Text style={s.label}>Phone number</Text>
            <View style={s.inputWrap}>
              <Text style={s.countryCode}>+91</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                maxLength={12}
                placeholder="98765 43210"
                placeholderTextColor={ZColors.textMuted}
                style={s.input}
              />
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!canSendOtp || isSendingOtp}
              onPress={handleSendOtp}
              style={[s.primaryBtn, { opacity: canSendOtp && !isSendingOtp ? 1 : 0.45 }]}
            >
              <Text style={s.primaryText}>
                {isSendingOtp ? 'Sending...' : otpSent ? 'Send OTP again' : 'Send OTP'}
              </Text>
              <MaterialIcons name="arrow-forward" size={18} color={ZColors.cream} />
            </TouchableOpacity>

            {otpSent && (
              <View style={s.otpBlock}>
                <View style={s.sentRow}>
                  <MaterialIcons name="check-circle" size={16} color={ZColors.olive} />
                  <Text style={s.sentText}>OTP sent to +91 {phoneDigits}</Text>
                </View>

                <Text style={s.label}>Enter OTP</Text>
                <View style={s.inputWrap}>
                  <TextInput
                    ref={otpInputRef}
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder="4-6 digit code"
                    placeholderTextColor={ZColors.textMuted}
                    style={[s.input, s.otpInput]}
                  />
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  disabled={!canContinue || isContinuing}
                  onPress={handleContinue}
                  style={[
                    s.primaryBtn,
                    s.continueBtn,
                    { opacity: canContinue && !isContinuing ? 1 : 0.45 },
                  ]}
                >
                  <Text style={s.primaryText}>{isContinuing ? 'Verifying...' : 'Continue'}</Text>
                  <MaterialIcons name="arrow-forward" size={18} color={ZColors.cream} />
                </TouchableOpacity>
              </View>
            )}

            {error ? (
              <View style={s.errorBox}>
                <MaterialIcons name="error-outline" size={15} color={ZColors.coralDeep} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}
          </View>

          <TouchableOpacity style={s.supportLink} activeOpacity={0.75}>
            <MaterialIcons name="phone-in-talk" size={14} color={ZColors.coralDeep} />
            <Text style={s.supportText}>I need immediate support</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ZColors.cream },
  scroll: { padding: 20, paddingBottom: 140, gap: 16, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  brand: { fontSize: 24, fontWeight: '800', color: ZColors.forest, letterSpacing: -0.4 },
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
    gap: 8,
    marginTop: 18,
  },
  iconNode: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(244, 244, 240, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  title: { fontSize: 26, fontWeight: '800', color: ZColors.textPrimary, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: ZColors.textSecondary, lineHeight: 20 },
  formCard: {
    backgroundColor: ZColors.creamCard,
    borderRadius: ZRadius.card,
    padding: 16,
    gap: 10,
  },
  label: { fontSize: 13, fontWeight: '700', color: ZColors.textPrimary },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ZColors.cream,
    borderRadius: ZRadius.small,
    borderWidth: 1,
    borderColor: ZColors.creamDark,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  countryCode: {
    fontSize: 15,
    fontWeight: '700',
    color: ZColors.forest,
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: ZColors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ZColors.olive,
    borderRadius: ZRadius.pill,
    paddingVertical: 16,
    marginTop: 6,
    shadowColor: ZColors.forest,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryText: { fontSize: 16, fontWeight: '700', color: ZColors.cream },
  otpBlock: { gap: 10, marginTop: 8 },
  sentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(212, 227, 200, 0.55)',
    borderRadius: ZRadius.small,
    padding: 10,
  },
  sentText: { flex: 1, fontSize: 12, color: ZColors.textSecondary, fontWeight: '600' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: ZColors.coralLight,
    borderRadius: ZRadius.small,
    padding: 10,
  },
  errorText: { flex: 1, fontSize: 12, color: ZColors.coralDeep, fontWeight: '700' },
  otpInput: {
    color: ZColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },
  continueBtn: { marginTop: 2 },
  supportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  supportText: { fontSize: 13, fontWeight: '700', color: ZColors.coralDeep },
});

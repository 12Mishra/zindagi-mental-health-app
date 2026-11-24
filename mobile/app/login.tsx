import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Moss } from '@/components/moss/moss';
import { Backdrop } from '@/components/z/backdrop';
import { PressScale, ZButton } from '@/components/z/press';
import { Clay, Frost } from '@/components/z/surfaces';
import { webNoOutline, ZColors, ZFont } from '@/constants/zindagi-theme';
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
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const phoneInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const otpInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [focus, setFocus] = useState<'phone' | 'otp' | null>(null);
  const { width } = useWindowDimensions();

  const phoneDigits = phone.replace(/\D/g, '');
  const otpDigits = otp.replace(/\D/g, '');
  const canSendOtp = phoneDigits.length === 10;
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
    <View style={{ flex: 1 }}>
      <Backdrop />
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          // 'height' on Android (edge-to-edge) resizes the screen mid-focus, which can close the keyboard as it opens.
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={s.scroll}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeIn.duration(400)} style={s.header}>
              <Text style={s.brand}>Zindagi</Text>
              <Frost radius={99} tint="sage"><Text style={s.stepText}>Step 1 of 3</Text></Frost>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(80).springify().damping(16)} style={s.hero}>
              <Moss expression={otpSent ? 'encouraging' : 'happy'} size={Math.min(190, width * 0.48)} />
              <Text style={s.title}>Login with your phone</Text>
              <Text style={s.subtitle}>
                Enter your mobile number. We will send a one-time password to verify your access.
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(160).springify().damping(16)}>
              <Clay radius={26} style={s.formCard}>
                <Text style={s.label}>Phone number</Text>
                <Pressable
                  onPress={() => phoneInputRef.current?.focus()}
                  style={[s.inputWrap, focus === 'phone' && s.inputFocus]}
                  accessible={false}
                >
                  <Text style={s.countryCode}>+91</Text>
                  <View style={s.sep} />
                  <TextInput
                    ref={phoneInputRef}
                    value={phone}
                    onChangeText={text => setPhone(text.replace(/\D/g, '').slice(0, 10))}
                    keyboardType="number-pad"
                    maxLength={10}
                    placeholder="98765 43210"
                    placeholderTextColor={ZColors.textMuted}
                    style={s.input}
                    onFocus={() => setFocus('phone')}
                    onBlur={() => setFocus(null)}
                    accessibilityLabel="Phone number"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                    showSoftInputOnFocus
                    returnKeyType="done"
                    onSubmitEditing={() => { void handleSendOtp(); }}
                  />
                  {canSendOtp && <MaterialIcons name="check-circle" size={18} color={ZColors.olive} />}
                </Pressable>

                <ZButton
                  variant={otpSent ? 'clay' : 'gloss'}
                  label={isSendingOtp ? 'Sending…' : otpSent ? 'Send OTP again' : 'Send OTP'}
                  icon="arrow-forward"
                  iconRight
                  loading={isSendingOtp}
                  disabled={!canSendOtp}
                  onPress={handleSendOtp}
                  style={{ marginTop: 4 }}
                />

                {otpSent && (
                  <Animated.View entering={FadeInDown.springify().damping(16)} style={s.otpBlock}>
                    <View style={s.sentRow}>
                      <MaterialIcons name="check-circle" size={16} color={ZColors.olive} />
                      <Text style={s.sentText}>OTP sent to +91 {phoneDigits}</Text>
                    </View>

                    <Text style={s.label}>Enter OTP</Text>
                    <Pressable
                      onPress={() => otpInputRef.current?.focus()}
                      style={[s.inputWrap, focus === 'otp' && s.inputFocus]}
                      accessible={false}
                    >
                      <TextInput
                        ref={otpInputRef}
                        value={otp}
                        onChangeText={setOtp}
                        keyboardType="number-pad"
                        maxLength={6}
                        placeholder="4-6 digit code"
                        placeholderTextColor={ZColors.textMuted}
                        style={[s.input, s.otpInput]}
                        onFocus={() => setFocus('otp')}
                        onBlur={() => setFocus(null)}
                        accessibilityLabel="One-time password"
                        autoComplete="sms-otp"
                        textContentType="oneTimeCode"
                        showSoftInputOnFocus
                      />
                    </Pressable>

                    <ZButton
                      label={isContinuing ? 'Verifying…' : 'Continue'}
                      icon="arrow-forward"
                      iconRight
                      loading={isContinuing}
                      disabled={!canContinue}
                      onPress={handleContinue}
                    />
                  </Animated.View>
                )}

                {error ? (
                  <Animated.View entering={FadeIn} style={s.errorBox}>
                    <MaterialIcons name="error-outline" size={15} color={ZColors.coralDeep} />
                    <Text style={s.errorText}>{error}</Text>
                  </Animated.View>
                ) : null}
              </Clay>
            </Animated.View>

            <PressScale style={s.supportLink} accessibilityRole="button" accessibilityLabel="I need immediate support">
              <MaterialIcons name="phone-in-talk" size={15} color={ZColors.coralDeep} />
              <Text style={s.supportText}>I need immediate support</Text>
            </PressScale>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 140, gap: 18, flexGrow: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  brand: { fontSize: 24, fontFamily: ZFont.display, color: ZColors.forest, letterSpacing: -0.6 },
  stepText: { fontSize: 11.5, fontFamily: ZFont.bold, color: ZColors.forest, paddingHorizontal: 12, paddingVertical: 6 },
  hero: { alignItems: 'center', gap: 6, marginTop: 4 },
  title: { fontSize: 30, fontFamily: ZFont.display, color: ZColors.ink, letterSpacing: -0.9, textAlign: 'center', marginTop: -4 },
  subtitle: { fontSize: 14, color: ZColors.textSecondary, lineHeight: 21, textAlign: 'center', fontFamily: ZFont.regular, maxWidth: 330 },
  formCard: { padding: 18, gap: 10 },
  label: { fontSize: 13, fontFamily: ZFont.bold, color: ZColors.textPrimary },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 16,
    borderWidth: 1.5, borderColor: ZColors.hairline, minHeight: 56, paddingHorizontal: 16,
  },
  // Focus only recolours the field. Toggling elevation/shadow here rebuilds the native view on Android
  // and drops focus from the TextInput, so the keypad flashes and closes.
  inputFocus: { borderColor: ZColors.sageMid, backgroundColor: '#FFFFFF' },
  countryCode: { fontSize: 16, fontFamily: ZFont.bold, color: ZColors.forest },
  sep: { width: 1, height: 22, backgroundColor: ZColors.hairline },
  input: { flex: 1, alignSelf: 'stretch', color: ZColors.textPrimary, fontSize: 17, fontFamily: ZFont.semibold, paddingVertical: 12, ...webNoOutline },
  otpBlock: { gap: 10, marginTop: 8 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(212, 227, 200, 0.55)', borderRadius: 12, padding: 10 },
  sentText: { flex: 1, fontSize: 12.5, color: ZColors.textSecondary, fontFamily: ZFont.semibold },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: ZColors.coralLight, borderRadius: 12, padding: 10 },
  errorText: { flex: 1, fontSize: 12.5, color: ZColors.coralDeep, fontFamily: ZFont.bold },
  otpInput: { fontSize: 20, fontFamily: ZFont.heavy, letterSpacing: 6 },
  supportLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, alignSelf: 'center' },
  supportText: { fontSize: 14, fontFamily: ZFont.bold, color: ZColors.coralDeep },
});

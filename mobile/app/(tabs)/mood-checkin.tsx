import { MaterialIcons } from "@expo/vector-icons";
import { useScreenFocused } from "@/hooks/use-screen-focused";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { Moss } from "@/components/moss/moss";
import { Backdrop } from "@/components/z/backdrop";
import { PressScale, ZButton } from "@/components/z/press";
import { Clay, Frost } from "@/components/z/surfaces";
import { webNoOutline, ZColors, ZFont } from "@/constants/zindagi-theme";
import { logout } from "@/lib/auth-api";
import { clearAuthSession, getAuthSession } from "@/lib/auth-session";
import { getTodayMood, saveTodayMood, type DailyMood } from "@/lib/daily-mood";
import { moodReaction } from "@/lib/tone";

// ── Mood data ─────────────────────────────────────────────────────────────────

type Mood = { id: string; label: string; dot: string; selected: readonly [string, string]; danger?: boolean };

const MOODS: Mood[] = [
  { id: "anxious", label: "Anxious", dot: ZColors.sage, selected: ["#8FAA82", "#556040"] },
  { id: "angry", label: "Angry", dot: ZColors.olive, selected: ["#6B7C4F", "#2D4A1E"] },
  { id: "sad", label: "Sad", dot: "#C8D5B9", selected: ["#A8C48A", "#6B8A5A"] },
  { id: "fatigued", label: "Fatigued", dot: ZColors.sageLight, selected: ["#A8B89B", "#7A8C6C"] },
  { id: "unsafe", label: "Unsafe", dot: ZColors.coralDeep, selected: ["#FF8A78", "#E05C47"], danger: true },
  { id: "overwhelmed", label: "Overwhelmed", dot: ZColors.oliveDark, selected: ["#7E8F5E", "#3D4A2B"] },
  { id: "calm", label: "Calm", dot: ZColors.sageMid, selected: ["#A8C48A", "#6B7C4F"] },
  { id: "okay", label: "Okay", dot: "#A8C48A", selected: ["#8FAA82", "#556040"] },
];

// ── Screen ────────────────────────────────────────────────────────────────────
const getGreeting = () => {
  const hour = new Date().getHours();
  const name = getAuthSession()?.user.fullName.split(" ")[0] || "";
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Good night";
  return `${greeting}${name ? `, ${name}` : ""}`;
};
const formattedDate = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

function MoodChip({ mood, on, onPress, index }: { mood: Mood; on: boolean; onPress: () => void; index: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(120 + index * 35).springify().damping(16)} style={styles.chipCell}>
      <PressScale onPress={onPress} scaleTo={0.93} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={mood.label}
        style={[styles.chip, on && { shadowColor: mood.selected[1], shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 5 }]}>
        <LinearGradient colors={on ? mood.selected : ["#FFFFFF", "#EEF3E8"]} style={[StyleSheet.absoluteFill, styles.chipFill, !on && styles.chipEdge]} />
        {on
          ? <MaterialIcons name="check-circle" size={16} color="#FFFFFF" />
          : <View style={[styles.chipDot, { backgroundColor: mood.dot }]} />}
        <Text style={[styles.chipLabel, { color: on ? "#FFFFFF" : mood.danger ? ZColors.coralDeep : ZColors.textPrimary }]}>{mood.label}</Text>
      </PressScale>
    </Animated.View>
  );
}

export default function MoodCheckinScreen() {
  const focused = useScreenFocused();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [noteText, setNoteText] = useState("");
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const viewportH = useRef(0);
  const continueBottom = useRef(0);
  // While the note is being typed, scroll just enough that the Continue button sits above the keyboard.
  const revealContinue = useCallback(() => {
    setTimeout(() => {
      const y = continueBottom.current - viewportH.current + 24;
      if (y > 0) scrollRef.current?.scrollTo({ y, animated: true });
    }, 250);
  }, []);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Already checked in today: hide the question but keep the home screen reachable.
  // Re-read on every focus so a tab left open past midnight asks again.
  const [todayMood, setTodayMood] = useState<DailyMood | null>(() => getTodayMood(getAuthSession()?.user.id));
  useFocusEffect(
    useCallback(() => {
      setTodayMood(getTodayMood(getAuthSession()?.user.id));
    }, []),
  );

  const reaction = useMemo(() => moodReaction(todayMood ? todayMood.moods : selected), [selected, todayMood]);
  const mossFace = reaction?.expression ?? "happy";
  const mossLine = reaction?.line ?? "Hi! Tap whatever fits. You can pick more than one.";
  const unsafePicked = selected.has("unsafe") || !!todayMood?.moods.includes("unsafe");

  const canContinue = selected.size > 0;

  const handleContinue = () => {
    if (!canContinue) return;
    saveTodayMood(getAuthSession()?.user.id, Array.from(selected), noteText);
    setTodayMood(getTodayMood(getAuthSession()?.user.id));
    setSelected(new Set());
    setNoteText("");
    router.push({
      pathname: '/voice',
      params: {
        moods: Array.from(selected).join(','),
        note: noteText || '',
      },
    });
  };

  const handleLogout = async () => {
    const auth = getAuthSession();
    try {
      setLogoutError("");
      setIsLoggingOut(true);
      if (auth?.session.token) await logout(auth.session.token);
      clearAuthSession();
      router.replace("/login");
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "Could not log out.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {/* Padding (not window resize) on Android too: the app is edge-to-edge, so the keyboard would cover Continue. */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          onLayout={e => { viewportH.current = e.nativeEvent.layout.height; }}
        >
          {/* ── Header ── */}
          <Animated.View entering={FadeIn.duration(400)} style={styles.header}>
            <View style={styles.logoRow}>
              <View style={styles.brandRow}>
                <LinearGradient colors={["#A8C48A", "#556040"]} style={styles.brandDot} />
                <Text style={styles.brand}>Zindagi</Text>
              </View>
              <PressScale disabled={isLoggingOut} onPress={handleLogout} accessibilityLabel="Log out" accessibilityRole="button">
                <Frost radius={14} style={styles.logoutBtn}>
                  <View style={styles.logoutInner}><MaterialIcons name="logout" size={18} color={ZColors.forest} /></View>
                </Frost>
              </PressScale>
            </View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.dateText}>{formattedDate()}</Text>
          </Animated.View>

          {logoutError ? (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={15} color={ZColors.coralDeep} />
              <Text style={styles.errorText}>{logoutError}</Text>
            </View>
          ) : null}

          {/* ── Prompt card with Moss ── */}
          <Animated.View entering={FadeInDown.delay(60).springify().damping(16)} layout={LinearTransition.springify().damping(18)}>
            <Clay radius={28} style={styles.promptCard}>
              <View style={styles.mossPeek} pointerEvents="none">
                <Moss expression={mossFace} size={118} active={focused} />
              </View>
              <Text style={styles.promptTitle}>{todayMood ? "You've checked in today" : "How are you feeling right now?"}</Text>
              <View style={[styles.say, unsafePicked && styles.sayUrgent]}>
                <Text style={styles.sayText}>{mossLine}</Text>
              </View>
              {todayMood ? (
                <Text style={styles.promptSub}>
                  Feeling: {todayMood.moods.map((id) => MOODS.find((m) => m.id === id)?.label ?? id).join(", ")}.
                  Lisa already knows, so there&apos;s nothing more to fill in.
                </Text>
              ) : (
                <>
                  <Text style={styles.promptSub}>Select all that apply. Your responses are anonymous and encrypted.</Text>
                  <View style={styles.grid}>
                    {MOODS.map((mood, i) => (
                      <MoodChip key={mood.id} mood={mood} index={i} on={selected.has(mood.id)} onPress={() => toggle(mood.id)} />
                    ))}
                  </View>
                  {selected.size > 0 && (
                    <Animated.Text entering={FadeIn} style={styles.hintText}>
                      {selected.size === 1 ? "1 feeling selected." : `${selected.size} feelings selected.`} Tap again to remove one.
                    </Animated.Text>
                  )}
                </>
              )}
            </Clay>
          </Animated.View>

          {todayMood ? (
            <ZButton label="Talk to Lisa" icon="arrow-forward" iconRight onPress={() => router.push("/voice")} />
          ) : (
            <>
              {/* ── Optional Note ── */}
              <Animated.View entering={FadeInDown.delay(160).springify().damping(16)}>
                <Frost radius={22} style={styles.noteCard}>
                  <View style={styles.noteInner}>
                    <Text style={styles.cardTitle}>Add a note <Text style={styles.optionalTag}>(optional)</Text></Text>
                    <TextInput
                      style={styles.noteInput}
                      placeholder="What's on your mind? Write freely…"
                      placeholderTextColor={ZColors.textMuted}
                      multiline
                      value={noteText}
                      onChangeText={setNoteText}
                      textAlignVertical="top"
                      accessibilityLabel="Note"
                      onFocus={revealContinue}
                      onContentSizeChange={revealContinue}
                    />
                  </View>
                </Frost>
              </Animated.View>
              <View onLayout={e => { const { y, height } = e.nativeEvent.layout; continueBottom.current = y + height; }}>
                <ZButton label="Continue" icon="arrow-forward" iconRight disabled={!canContinue} onPress={handleContinue} />
              </View>
            </>
          )}

          {/* ── Links ── */}
          <View style={styles.links}>
            <ZButton variant="ghost" compact icon="support-agent" label="Talk to a campus counsellor" onPress={() => router.push("/counsellor" as any)} />
            <ZButton variant="ghost" compact icon="favorite-border" label="People I trust" onPress={() => router.push("/trusted-contacts" as any)} />
            <PressScale style={[styles.urgent, unsafePicked && styles.urgentLit]} accessibilityRole="button" accessibilityLabel="I need immediate support">
              <MaterialIcons name="phone-in-talk" size={16} color={ZColors.coralDeep} />
              <Text style={styles.urgentText}>I need immediate support</Text>
            </PressScale>
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingTop: 8, gap: 16, paddingBottom: 40, flexGrow: 1 },

  header: { gap: 2, marginBottom: 2 },
  logoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandDot: { width: 11, height: 11, borderRadius: 6 },
  brand: { fontSize: 22, fontFamily: ZFont.display, color: ZColors.forest, letterSpacing: -0.6 },
  logoutBtn: {},
  logoutInner: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  greeting: { fontSize: 30, fontFamily: ZFont.display, color: ZColors.ink, letterSpacing: -0.9, lineHeight: 34 },
  dateText: { fontSize: 13.5, color: ZColors.textMuted, fontFamily: ZFont.medium },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: ZColors.coralLight, borderRadius: 12, padding: 10 },
  errorText: { flex: 1, fontSize: 12, color: ZColors.coralDeep, fontFamily: ZFont.bold },

  promptCard: { padding: 18, paddingTop: 20, gap: 12, marginTop: 40 },
  mossPeek: { position: "absolute", right: -8, top: -62 },
  promptTitle: { fontSize: 19, fontFamily: ZFont.heavy, color: ZColors.ink, letterSpacing: -0.3, maxWidth: "64%", lineHeight: 24 },
  say: { alignSelf: "flex-start", maxWidth: "88%", backgroundColor: "rgba(212,227,200,0.65)", borderRadius: 14, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  sayUrgent: { backgroundColor: "rgba(255,179,167,0.45)" },
  sayText: { fontSize: 13, color: ZColors.forest, fontFamily: ZFont.semibold, lineHeight: 18 },
  promptSub: { fontSize: 12.5, color: ZColors.textSecondary, lineHeight: 18, fontFamily: ZFont.regular },

  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  chipCell: { width: "48.5%" },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 15, paddingHorizontal: 14, borderRadius: 18, minHeight: 52 },
  chipFill: { borderRadius: 18 },
  chipEdge: { borderWidth: 1, borderColor: "#FFFFFF", shadowColor: "#2D4A1E" },
  chipDot: { width: 10, height: 10, borderRadius: 5 },
  chipLabel: { fontSize: 14.5, fontFamily: ZFont.bold },
  hintText: { fontSize: 12, color: ZColors.textMuted, fontFamily: ZFont.medium, textAlign: "center" },

  noteCard: {},
  noteInner: { padding: 16, gap: 8 },
  cardTitle: { fontSize: 14.5, fontFamily: ZFont.bold, color: ZColors.textPrimary },
  optionalTag: { fontSize: 12.5, fontFamily: ZFont.regular, color: ZColors.textMuted },
  noteInput: {
    backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 14, padding: 14, minHeight: 88, fontSize: 15,
    fontFamily: ZFont.regular, color: ZColors.textPrimary, borderWidth: 1, borderColor: ZColors.hairline, ...webNoOutline,
  },

  links: { alignItems: "center", gap: 2, marginTop: 2 },
  urgent: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 99, marginTop: 2 },
  urgentLit: { backgroundColor: "rgba(224,92,71,0.12)", borderWidth: 1, borderColor: "rgba(224,92,71,0.35)" },
  urgentText: { fontSize: 14, color: ZColors.coralDeep, fontFamily: ZFont.bold },
});

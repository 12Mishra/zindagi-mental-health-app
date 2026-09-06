import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ZColors, ZRadius, ZShadow } from "@/constants/zindagi-theme";
import { logout } from "@/lib/auth-api";
import { clearAuthSession, getAuthSession } from "@/lib/auth-session";

// ── Mood data ─────────────────────────────────────────────────────────────────

type Mood = {
  id: string;
  label: string;
  baseColor: string;
  textColor: string;
  selectedBg: string;
};

const MOODS: Mood[] = [
  {
    id: "anxious",
    label: "Anxious",
    baseColor: "rgba(168, 184, 155, 0.35)",
    textColor: ZColors.forest,
    selectedBg: ZColors.olive,
  },
  {
    id: "angry",
    label: "Angry",
    baseColor: "rgba(107, 124, 79, 0.22)",
    textColor: ZColors.forest,
    selectedBg: ZColors.forest,
  },
  {
    id: "sad",
    label: "Sad",
    baseColor: "rgba(212, 227, 200, 0.6)",
    textColor: ZColors.textSecondary,
    selectedBg: ZColors.sageMid,
  },
  {
    id: "fatigued",
    label: "Fatigued",
    baseColor: "rgba(212, 227, 200, 0.35)",
    textColor: ZColors.textSecondary,
    selectedBg: ZColors.sage,
  },
  {
    id: "unsafe",
    label: "Unsafe",
    baseColor: "rgba(255, 179, 167, 0.35)",
    textColor: ZColors.coralDeep,
    selectedBg: ZColors.coralDeep,
  },
  {
    id: "overwhelmed",
    label: "Overwhelmed",
    baseColor: "rgba(107, 124, 79, 0.18)",
    textColor: ZColors.forest,
    selectedBg: ZColors.oliveDark,
  },
  {
    id: "calm",
    label: "Calm",
    baseColor: "rgba(143, 170, 130, 0.4)",
    textColor: ZColors.forest,
    selectedBg: ZColors.sageMid,
  },
  {
    id: "okay",
    label: "Okay",
    baseColor: "rgba(168, 184, 155, 0.5)",
    textColor: ZColors.textSecondary,
    selectedBg: ZColors.olive,
  },
];

// ── Screen ────────────────────────────────────────────────────────────────────
const getGreeting = () => {
  const hour = new Date().getHours();
  const authInfo = getAuthSession();
  const name = authInfo?.user.fullName.split(" ")[0] || "";

  let greeting = "";

  if (hour < 12) {
    greeting = "Good Morning";
  } else if (hour < 17) {
    greeting = "Good Afternoon";
  } else if (hour < 21) {
    greeting = "Good Evening";
  } else {
    greeting = "Good Night";
  }

  return `${greeting}${name ? `, ${name}` : ""}`;
};
const formattedDate = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export default function MoodCheckinScreen() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [noteText, setNoteText] = useState("");
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

  const canContinue = selected.size > 0;

  const handleContinue = () => {
    if (!canContinue) return;
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

      if (auth?.session.token) {
        await logout(auth.session.token);
      }

      clearAuthSession();
      router.replace("/login");
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "Could not log out.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: ZColors.cream }}>
      <StatusBar style="dark" backgroundColor={ZColors.cream} />
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.logoRow}>
            <Text style={s.brand}>Zindagi</Text>
            <View style={s.headerActions}>
              <TouchableOpacity
                activeOpacity={0.75}
                disabled={isLoggingOut}
                onPress={handleLogout}
                style={[s.logoutBtn, { opacity: isLoggingOut ? 0.45 : 1 }]}
              >
                <MaterialIcons name="logout" size={17} color={ZColors.forest} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={s.greeting}>{getGreeting()}</Text>
          <Text style={s.dateText}>{formattedDate}</Text>
        </View>

        {logoutError ? (
          <View style={s.errorBox}>
            <MaterialIcons
              name="error-outline"
              size={15}
              color={ZColors.coralDeep}
            />
            <Text style={s.errorText}>{logoutError}</Text>
          </View>
        ) : null}

        {/* ── Prompt ── */}
        <View style={s.promptCard}>
          <Text style={s.promptTitle}>How are you feeling right now?</Text>
          <Text style={s.promptSub}>
            Select all that apply. Your responses are anonymous and encrypted.
          </Text>
        </View>

        {/* ── Mood Grid ── */}
        <View style={s.grid}>
          {MOODS.map((mood) => {
            const isSelected = selected.has(mood.id);
            return (
              <TouchableOpacity
                key={mood.id}
                activeOpacity={0.75}
                onPress={() => toggle(mood.id)}
                style={[
                  s.moodBtn,
                  ZShadow.subtle,
                  {
                    backgroundColor: isSelected
                      ? mood.selectedBg
                      : mood.baseColor,
                  },
                ]}
              >
                {isSelected && (
                  <MaterialIcons
                    name="check"
                    size={14}
                    color="#FFFFFF"
                    style={{ marginRight: 4 }}
                  />
                )}
                <Text
                  style={[
                    s.moodLabel,
                    { color: isSelected ? "#FFFFFF" : mood.textColor },
                  ]}
                >
                  {mood.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Intensity Hint ── */}
        {selected.size > 0 && (
          <View style={s.hintCard}>
            <MaterialIcons
              name="info-outline"
              size={14}
              color={ZColors.textMuted}
            />
            <Text style={s.hintText}>
              {selected.size === 1
                ? `You selected 1 feeling.`
                : `You selected ${selected.size} feelings.`}{" "}
              Tap a feeling again to deselect it.
            </Text>
          </View>
        )}

        {/* ── Optional Note ── */}
        <View style={[s.card]}>
          <Text style={s.cardTitle}>
            Add a note <Text style={s.optionalTag}>(optional)</Text>
          </Text>
          <TextInput
            style={s.noteInput}
            placeholder="What's on your mind? Write freely..."
            placeholderTextColor={ZColors.textMuted}
            multiline
            value={noteText}
            onChangeText={setNoteText}
            textAlignVertical="top"
          />
        </View>

        {/* ── Continue Button ── */}
        <TouchableOpacity
          activeOpacity={0.8}
          style={[s.continueBtn, { opacity: canContinue ? 1 : 0.45 }]}
          disabled={!canContinue}
          onPress={handleContinue}
        >
          <Text style={s.continueBtnText}>Continue</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>

        {/* ── Crisis Link ── */}
        <TouchableOpacity style={s.crisisLink}>
          <MaterialIcons
            name="phone-in-talk"
            size={14}
            color={ZColors.coralDeep}
          />
          <Text style={s.crisisLinkText}>I need immediate support</Text>
        </TouchableOpacity>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { padding: 20, gap: 16 },

  header: { gap: 4, marginBottom: 4 },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontSize: 22,
    fontWeight: "800",
    color: ZColors.forest,
    letterSpacing: -0.5,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: ZColors.coralLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: ZRadius.pill,
  },
  streakText: { fontSize: 11, fontWeight: "700", color: ZColors.coralDeep },
  logoutBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ZColors.creamCard,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: ZColors.creamDark,
  },
  greeting: {
    fontSize: 26,
    fontWeight: "700",
    color: ZColors.textPrimary,
    marginTop: 6,
  },
  dateText: { fontSize: 13, color: ZColors.textMuted },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: ZColors.coralLight,
    borderRadius: ZRadius.small,
    padding: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: ZColors.coralDeep,
    fontWeight: "700",
  },

  promptCard: {
    backgroundColor: ZColors.sageLight,
    borderRadius: ZRadius.card,
    padding: 18,
    gap: 6,
  },
  promptTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: ZColors.forest,
  },
  promptSub: { fontSize: 12, color: ZColors.textSecondary, lineHeight: 18 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  moodBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "47.5%",
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderRadius: ZRadius.pill,
  },
  moodLabel: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },

  hintCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: ZColors.creamCard,
    borderRadius: ZRadius.small,
    padding: 12,
  },
  hintText: { fontSize: 12, color: ZColors.textMuted, flex: 1, lineHeight: 17 },

  card: {
    backgroundColor: ZColors.creamCard,
    borderRadius: ZRadius.card,
    padding: 16,
    gap: 6,
  },
  cardTitle: { fontSize: 14, fontWeight: "700", color: ZColors.textPrimary },
  cardSub: { fontSize: 12, color: ZColors.textMuted },
  optionalTag: { fontSize: 12, fontWeight: "400", color: ZColors.textMuted },

  sliderTrack: {
    height: 6,
    backgroundColor: ZColors.creamDark,
    borderRadius: ZRadius.pill,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  sliderFill: {
    width: "45%",
    height: "100%",
    backgroundColor: ZColors.olive,
    borderRadius: ZRadius.pill,
  },
  sliderThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: ZColors.olive,
    marginLeft: -9,
    shadowColor: ZColors.olive,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  sliderLabel: { fontSize: 10, color: ZColors.textMuted },

  noteInput: {
    backgroundColor: ZColors.cream,
    borderRadius: ZRadius.small,
    padding: 14,
    minHeight: 80,
    marginTop: 4,
  },
  notePlaceholder: { fontSize: 13, color: ZColors.textMuted, lineHeight: 20 },

  continueBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: ZColors.olive,
    borderRadius: ZRadius.pill,
    paddingVertical: 16,
    shadowColor: ZColors.forest,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  continueBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },

  crisisLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  crisisLinkText: { fontSize: 13, color: ZColors.coralDeep, fontWeight: "600" },
});

import React, { useState } from "react";
import { StyleSheet, Text, View, TouchableOpacity } from "react-native";
import { Audio } from "expo-av";
import { Feather } from "@expo/vector-icons";

export default function VoiceCheckInScreen() {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  async function startRecording() {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );

      setRecording(recording);
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording", err);
    }
  }

  async function stopRecording() {
    if (!recording) return;

    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);

    console.log("Recording stopped and stored at", uri);
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
        <Text style={styles.title}>Daily Check-in</Text>
        <Text style={styles.subtitle}>How are you feeling today?</Text>
      </View>

      {/* Main Voice Interaction Node */}
      <View style={styles.interactionArea}>
        <TouchableOpacity
          style={[
            styles.recordButton,
            isRecording && styles.recordButtonActive,
          ]}
          onPress={isRecording ? stopRecording : startRecording}
          activeOpacity={0.8}
        >
          <Feather
            name={isRecording ? "square" : "mic"}
            size={36}
            color={isRecording ? "#2C4C3B" : "#F4F4F0"}
          />
        </TouchableOpacity>

        <Text style={styles.statusText}>
          {isRecording ? "Listening safely..." : "Tap to speak"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F4F0", // Soft off-white base
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  headerContainer: {
    alignItems: "center",
    marginTop: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#2C4C3B", // Deep Forest Green
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: "#7A9A7E", // Sage Green
    fontWeight: "500",
  },
  interactionArea: {
    alignItems: "center",
    marginBottom: 80,
  },
  recordButton: {
    width: 120,
    height: 120,
    borderRadius: 60, // Fully rounded pill/circle
    backgroundColor: "#7A9A7E", // Default Sage/Olive state
    alignItems: "center",
    justifyContent: "center",
    // Soft, diffuse neumorphic shadow
    shadowColor: "#2C4C3B",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 24,
  },
  recordButtonActive: {
    backgroundColor: "#FFB3A7", // Soft Coral accent for active recording
    shadowColor: "#FFB3A7",
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  statusText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2C4C3B", // Deep Forest Green
  },
});

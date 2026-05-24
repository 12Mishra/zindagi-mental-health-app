import { MaterialIcons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ZColors, ZRadius } from "@/constants/zindagi-theme";
import { getAuthSession } from "@/lib/auth-session";
import {
  getAudioUrl,
  getMessages,
  sendVoiceMessage,
  startConversation,
  type Message,
} from "@/lib/voice-api";

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string; moods?: string }>();
  const flatListRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(
    params.conversationId ?? null
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Initialize conversation if needed
  useEffect(() => {
    const init = async () => {
      if (conversationId) {
        await loadMessages();
        return;
      }

      const auth = getAuthSession();
      if (!auth) return;

      try {
        const moods = params.moods ? JSON.parse(params.moods) : [];
        const res = await startConversation(auth.session.token, moods);
        setConversationId(res.conversationId);
      } catch (err) {
        console.error("Failed to start conversation:", err);
      }
    };
    init();
  }, []);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    const auth = getAuthSession();
    if (!auth) return;

    try {
      const res = await getMessages(auth.session.token, conversationId);
      setMessages(res.messages);
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  }, [conversationId]);

  // Auto-scroll when messages change
  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);

      if (uri && conversationId) {
        await uploadAndProcess(uri);
      }
    } catch (err) {
      console.error("Failed to stop recording:", err);
    }
  };

  const uploadAndProcess = async (audioUri: string) => {
    const auth = getAuthSession();
    if (!auth || !conversationId) return;

    setIsProcessing(true);
    try {
      const res = await sendVoiceMessage(
        auth.session.token,
        conversationId,
        audioUri
      );
      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);

      // Auto-play Lisa's response
      if (res.assistantMessage.audioUrl) {
        await playAudio(res.assistantMessage.id, res.assistantMessage.audioUrl);
      }
    } catch (err) {
      console.error("Failed to process voice message:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const playAudio = async (messageId: string, audioUrl?: string) => {
    try {
      // Stop any currently playing audio
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
        setPlayingId(null);
      }

      const url = audioUrl?.startsWith("http")
        ? audioUrl
        : getAudioUrl(messageId);

      const sound = new Audio.Sound();
      await sound.loadAsync({ uri: url });
      soundRef.current = sound;
      setPlayingId(messageId);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingId(null);
          sound.unloadAsync();
          soundRef.current = null;
        }
      });

      await sound.playAsync();
    } catch (err) {
      console.error("Failed to play audio:", err);
      setPlayingId(null);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === "USER";
    const isPlaying = playingId === item.id;

    return (
      <View
        style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        {!isUser && (
          <Text style={styles.senderName}>Lisa</Text>
        )}
        <Text style={[styles.messageText, isUser && styles.userMessageText]}>
          {item.content}
        </Text>
        {!isUser && item.audioUrl && (
          <TouchableOpacity
            style={styles.playButton}
            onPress={() => playAudio(item.id, item.audioUrl)}
          >
            <MaterialIcons
              name={isPlaying ? "pause" : "play-arrow"}
              size={18}
              color={ZColors.forest}
            />
            <Text style={styles.playText}>
              {isPlaying ? "Playing..." : "Listen"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lisa</Text>
        <Text style={styles.headerSubtitle}>Your wellness companion</Text>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialIcons
                name="self-improvement"
                size={48}
                color={ZColors.sageMid}
              />
              <Text style={styles.emptyText}>
                Start a conversation with Lisa
              </Text>
              <Text style={styles.emptySubtext}>
                Tap the microphone to share how you're feeling
              </Text>
            </View>
          }
        />

        {/* Processing indicator */}
        {isProcessing && (
          <View style={styles.processingBar}>
            <ActivityIndicator size="small" color={ZColors.forest} />
            <Text style={styles.processingText}>Lisa is thinking...</Text>
          </View>
        )}

        {/* Record button */}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={[
              styles.recordButton,
              isRecording && styles.recordButtonActive,
            ]}
            onPress={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
          >
            <MaterialIcons
              name={isRecording ? "stop" : "mic"}
              size={28}
              color="#fff"
            />
          </TouchableOpacity>
          <Text style={styles.recordHint}>
            {isRecording
              ? "Tap to stop recording"
              : isProcessing
              ? "Processing..."
              : "Tap to speak"}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ZColors.cream,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: ZColors.dark,
  },
  headerSubtitle: {
    fontSize: 13,
    color: ZColors.textSecondary,
    marginTop: 2,
  },
  chatArea: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
  },
  messageBubble: {
    maxWidth: "80%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: ZRadius.card,
    marginBottom: 10,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: ZColors.sage,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  senderName: {
    fontSize: 11,
    fontWeight: "600",
    color: ZColors.forest,
    marginBottom: 3,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    color: ZColors.dark,
  },
  userMessageText: {
    color: "#fff",
  },
  playButton: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    paddingVertical: 3,
  },
  playText: {
    fontSize: 12,
    color: ZColors.forest,
    marginLeft: 4,
    fontWeight: "500",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: ZColors.dark,
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: ZColors.textSecondary,
    marginTop: 4,
  },
  processingBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    backgroundColor: "rgba(212,227,200,0.4)",
  },
  processingText: {
    fontSize: 13,
    color: ZColors.forest,
    marginLeft: 8,
    fontWeight: "500",
  },
  inputBar: {
    alignItems: "center",
    paddingVertical: 16,
    paddingBottom: 24,
  },
  recordButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: ZColors.sage,
    justifyContent: "center",
    alignItems: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  recordButtonActive: {
    backgroundColor: ZColors.coral,
  },
  recordHint: {
    fontSize: 12,
    color: ZColors.textSecondary,
    marginTop: 8,
  },
});

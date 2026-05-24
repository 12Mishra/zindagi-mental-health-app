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
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ZColors, ZRadius } from "@/constants/zindagi-theme";
import { VOICE_API_URL } from "@/lib/api-config";
import { getAuthSession } from "@/lib/auth-session";
import {
  getMessages,
  startConversation,
  type Message,
} from "@/lib/voice-api";
import {
  VoiceWebSocket,
  recordAndSend,
  playAudioBuffer,
} from "@/lib/voice-websocket";

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    conversationId?: string;
    moods?: string;
  }>();
  const flatListRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(
    params.conversationId ?? null
  );

  // WebSocket state
  const wsRef = useRef<VoiceWebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const recordingStopRef = useRef<(() => Promise<void>) | null>(null);

  // Streaming response state
  const [liveTranscript, setLiveTranscript] = useState("");
  const [streamingResponse, setStreamingResponse] = useState("");
  const [isLisaSpeaking, setIsLisaSpeaking] = useState(false);
  const [wsStatus, setWsStatus] = useState("");
  const streamingResponseRef = useRef("");

  // Audio playback
  const [playingId, setPlayingId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const receivedStreamingAudioRef = useRef(false);

  // Initialize conversation and WebSocket
  useEffect(() => {
    const init = async () => {
      const auth = getAuthSession();
      if (!auth) {
        router.replace("/login");
        return;
      }
      authTokenRef.current = auth.session.token;

      let convId = conversationId;

      // Create conversation if needed
      if (!convId) {
        try {
          const moods = params.moods ? JSON.parse(params.moods) : [];
          const res = await startConversation(auth.session.token, moods);
          convId = res.conversationId;
          setConversationId(convId);
        } catch (err) {
          console.error("Failed to start conversation:", err);
          return;
        }
      }

      // Load existing messages
      try {
        const { messages: msgs } = await getMessages(auth.session.token, convId);
        setMessages(msgs);
      } catch (err) {
        console.error("Failed to load messages:", err);
      }

      // Connect WebSocket
      const ws = new VoiceWebSocket();
      ws.connect(auth.session.token, convId, {
        onOpen: () => setWsConnected(true),
        onClose: () => {
          setWsConnected(false);
          setIsLisaSpeaking(false);
        },
        onStatus: (status) => setWsStatus(status),
        onTranscript: (text, isFinal) => {
          if (!isFinal) {
            setLiveTranscript(text);
          } else {
            setLiveTranscript("");
            // Add user message
            setMessages((prev) => [
              ...prev,
              {
                id: `user-${Date.now()}`,
                conversationId: convId,
                role: "USER" as const,
                content: text,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
        },
        onResponseChunk: (text) => {
          streamingResponseRef.current += text;
          setStreamingResponse(streamingResponseRef.current);
        },
        onResponseEnd: (messageId, audioUrl) => {
          const receivedStreamingAudio = receivedStreamingAudioRef.current;
          receivedStreamingAudioRef.current = false;
          const fullText = streamingResponseRef.current;
          if (fullText) {
            setMessages((prev) => [
              ...prev,
              {
                id: messageId || `assistant-${Date.now()}`,
                conversationId: convId,
                role: "ASSISTANT" as const,
                content: fullText,
                audioUrl: audioUrl || undefined,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
          streamingResponseRef.current = "";
          setStreamingResponse("");
          setWsStatus("");
          if (!receivedStreamingAudio && messageId && audioUrl) {
            playAudioUrl(messageId, audioUrl);
          }
        },
        onAudio: async (audioData) => {
          receivedStreamingAudioRef.current = true;
          setIsLisaSpeaking(true);
          await playAudioBuffer(audioData, undefined, () => {
            setIsLisaSpeaking(false);
          });
        },
        onError: (msg) => {
          console.warn("WS error:", msg);
          setWsStatus("");
          setStreamingResponse("");
          streamingResponseRef.current = "";
          setIsLisaSpeaking(false);
        },
      });

      wsRef.current = ws;
    };

    init();

    return () => {
      wsRef.current?.disconnect();
      soundRef.current?.unloadAsync();
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages, streamingResponse, liveTranscript]);

  // Toggle recording (push-to-talk)
  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      if (recordingStopRef.current) {
        await recordingStopRef.current();
        recordingStopRef.current = null;
      }
    } else {
      // Start recording
      if (!wsRef.current || !conversationId) return;

      try {
        const { stop } = await recordAndSend(wsRef.current, (recording) => {
          setIsRecording(recording);
        });
        recordingStopRef.current = stop;
      } catch (err) {
        console.error("Failed to start recording:", err);
      }
    }
  };

  // Play audio from URL (for historical messages)
  const playAudioUrl = async (messageId: string, audioUrl: string) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
        setPlayingId(null);
      }

      const url = audioUrl.startsWith("http")
        ? audioUrl
        : `${VOICE_API_URL}${audioUrl}`;

      setIsLisaSpeaking(true);
      const { sound } = await Audio.Sound.createAsync(
        {
          uri: url,
          headers: authTokenRef.current
            ? { Authorization: `Bearer ${authTokenRef.current}` }
            : undefined,
        },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setPlayingId(messageId);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingId(null);
          setIsLisaSpeaking(false);
          sound.unloadAsync();
          soundRef.current = null;
        }
      });
    } catch (err) {
      console.warn("Failed to play audio:", err);
      setPlayingId(null);
      setIsLisaSpeaking(false);
    }
  };

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isUser = item.role === "USER";
      const isPlaying = playingId === item.id;

      return (
        <View
          style={[
            styles.messageBubble,
            isUser ? styles.userBubble : styles.assistantBubble,
          ]}
        >
          {!isUser && <Text style={styles.senderName}>Lisa</Text>}
          <Text style={[styles.messageText, isUser && styles.userMessageText]}>
            {item.content}
          </Text>
          {!isUser && item.audioUrl && (
            <TouchableOpacity
              style={styles.playButton}
              onPress={() => playAudioUrl(item.id, item.audioUrl!)}
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
    },
    [playingId]
  );

  const getStatusText = () => {
    if (!wsConnected) return "Connecting...";
    if (isRecording) return "Listening...";
    if (wsStatus === "transcribing") return "Transcribing...";
    if (wsStatus === "thinking") return "Lisa is thinking...";
    if (wsStatus === "speaking") return "Lisa is speaking...";
    if (streamingResponse) return "Lisa is responding...";
    return "Tap to speak";
  };

  const isBusy = isRecording || !!streamingResponse || isLisaSpeaking || !!wsStatus;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Lisa</Text>
          <Text style={styles.headerSubtitle}>Your wellness companion</Text>
        </View>
        <View style={styles.headerRight}>
          <View
            style={[
              styles.connectionDot,
              { backgroundColor: wsConnected ? ZColors.sage : ZColors.coral },
            ]}
          />
        </View>
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
            !streamingResponse && !liveTranscript ? (
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
                  Tap the microphone and speak naturally
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            <>
              {/* Live transcript (user speaking) */}
              {liveTranscript ? (
                <View style={[styles.messageBubble, styles.userBubble, styles.liveTranscript]}>
                  <Text style={[styles.messageText, styles.userMessageText]}>
                    {liveTranscript}
                  </Text>
                </View>
              ) : null}

              {/* Streaming response (Lisa typing) */}
              {streamingResponse ? (
                <View style={[styles.messageBubble, styles.assistantBubble]}>
                  <Text style={styles.senderName}>Lisa</Text>
                  <Text style={styles.messageText}>{streamingResponse}</Text>
                </View>
              ) : null}
            </>
          }
        />

        {/* Status bar */}
        {isBusy && (
          <View style={styles.processingBar}>
            {(wsStatus === "thinking" || wsStatus === "transcribing") && (
              <ActivityIndicator size="small" color={ZColors.forest} />
            )}
            <Text style={styles.processingText}>{getStatusText()}</Text>
          </View>
        )}

        {/* Mic button */}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={[
              styles.recordButton,
              isRecording && styles.recordButtonActive,
              !wsConnected && styles.recordButtonDisabled,
            ]}
            onPress={toggleRecording}
            disabled={!wsConnected || (isBusy && !isRecording)}
          >
            <MaterialIcons
              name={isRecording ? "stop" : "mic"}
              size={28}
              color="#fff"
            />
          </TouchableOpacity>
          <Text style={styles.recordHint}>{getStatusText()}</Text>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    alignItems: "center",
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
  connectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
  liveTranscript: {
    opacity: 0.7,
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
    gap: 8,
  },
  processingText: {
    fontSize: 13,
    color: ZColors.forest,
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
  recordButtonDisabled: {
    opacity: 0.5,
  },
  recordHint: {
    fontSize: 12,
    color: ZColors.textSecondary,
    marginTop: 8,
  },
});

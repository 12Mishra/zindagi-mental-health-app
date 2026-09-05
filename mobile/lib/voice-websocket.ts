import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";
import { fromByteArray } from "base64-js";

import { VOICE_WS_URL } from "./api-config";

type WSEventType =
  | "status"
  | "transcript"
  | "response_chunk"
  | "response_end"
  | "error";

type WSEvent = {
  type: WSEventType;
  text?: string;
  isFinal?: boolean;
  messageId?: string;
  audioUrl?: string;
  message?: string;
};

type WSCallbacks = {
  onStatus?: (status: string) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onResponseChunk?: (text: string) => void;
  onResponseEnd?: (messageId: string, audioUrl?: string) => void;
  onAudio?: (audioData: ArrayBuffer) => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export class VoiceWebSocket {
  private ws: WebSocket | null = null;
  private callbacks: WSCallbacks = {};
  private conversationId: string = "";

  connect(token: string, conversationId: string, callbacks: WSCallbacks) {
    this.conversationId = conversationId;
    this.callbacks = callbacks;

    const url = `${VOICE_WS_URL}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log("Voice WebSocket connected");
      this.callbacks.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // JSON text message
        try {
          const msg: WSEvent = JSON.parse(event.data);
          switch (msg.type) {
            case "status":
              this.callbacks.onStatus?.(msg.text || "");
              break;
            case "transcript":
              this.callbacks.onTranscript?.(msg.text || "", msg.isFinal || false);
              break;
            case "response_chunk":
              this.callbacks.onResponseChunk?.(msg.text || "");
              break;
            case "response_end":
              this.callbacks.onResponseEnd?.(
                msg.messageId || "",
                msg.audioUrl
              );
              break;
            case "error":
              this.callbacks.onError?.(msg.message || "Unknown error");
              break;
          }
        } catch (e) {
          console.warn("Failed to parse WS message:", e);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Binary audio data (TTS)
        this.callbacks.onAudio?.(event.data);
      }
    };

    this.ws.onerror = () => {
      console.warn(`Voice WebSocket connection failed: ${VOICE_WS_URL}`);
      this.callbacks.onError?.(`Connection failed: ${VOICE_WS_URL}`);
    };

    this.ws.onclose = (event) => {
      console.log(
        `Voice WebSocket closed: code=${event.code} reason=${event.reason || "none"}`
      );
      this.callbacks.onClose?.();
    };
  }

  // Signal that user started speaking
  sendStart() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "start",
          conversationId: this.conversationId,
        })
      );
    }
  }

  // Signal that user stopped speaking
  sendStop() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "stop" }));
    }
  }

  // Send audio data (binary)
  sendAudio(data: ArrayBuffer | Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  // Send a text message instead of voice
  sendText(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "text",
          content: text,
          conversationId: this.conversationId,
        })
      );
    }
  }

  // Disconnect
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // Check if connected
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Helper: record audio and send chunks over WebSocket
export async function recordAndSend(
  ws: VoiceWebSocket,
  onStatusChange?: (recording: boolean) => void
): Promise<{ stop: () => Promise<void> }> {
  const permission = await Audio.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Microphone permission not granted");
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY
  );

  ws.sendStart();
  onStatusChange?.(true);

  // Poll for audio data every 500ms and send to server
  // Note: expo-av doesn't support streaming, so we record and send on stop
  // For true streaming, we'd need a native module

  let stopped = false;

  const stop = async () => {
    if (stopped) return;
    stopped = true;

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      onStatusChange?.(false);

      const uri = recording.getURI();
      if (uri) {
        // Read the file and send as binary
        const response = await fetch(uri);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        ws.sendAudio(arrayBuffer);
      }

      ws.sendStop();
    } catch (e) {
      console.error("Failed to stop recording:", e);
      ws.sendStop();
    }
  };

  return { stop };
}

// Helper: play audio from ArrayBuffer
export async function playAudioBuffer(
  audioData: ArrayBuffer,
  onPlaybackStart?: () => void,
  onPlaybackEnd?: () => void
) {
  try {
    const uint8Array = new Uint8Array(audioData);
    const base64 = fromByteArray(uint8Array);
    const fileUri = `${FileSystem.cacheDirectory}voice-${Date.now()}.mp3`;

    await FileSystem.writeAsStringAsync(fileUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: fileUri },
      { shouldPlay: true }
    );

    onPlaybackStart?.();

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        onPlaybackEnd?.();
        sound.unloadAsync();
      }
    });
  } catch (e) {
    console.error("Failed to play audio buffer:", e);
    onPlaybackEnd?.();
  }
}

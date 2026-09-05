import { VOICE_API_URL } from "./api-config";

export class VoiceApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Message = {
  id: string;
  conversationId: string;
  role: "USER" | "ASSISTANT";
  content: string;
  audioUrl?: string;
  createdAt: string;
};

type VoiceResponse = {
  userMessage: Message;
  assistantMessage: Message;
};

async function voiceRequest<T>(
  path: string,
  options: { method?: string; body?: Record<string, unknown>; token?: string } = {}
): Promise<T> {
  const response = await fetch(`${VOICE_API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new VoiceApiError(
      typeof data.error === "string" ? data.error : "Request failed.",
      response.status
    );
  }

  return data as T;
}

export const startConversation = (token: string, moods: string[]) =>
  voiceRequest<{ conversationId: string }>("/voice/conversation", {
    method: "POST",
    body: { moods },
    token,
  });

export const sendVoiceMessage = async (
  token: string,
  conversationId: string,
  audioUri: string
): Promise<VoiceResponse> => {
  const formData = new FormData();
  formData.append("audio", {
    uri: audioUri,
    name: "recording.m4a",
    type: "audio/m4a",
  } as unknown as Blob);
  formData.append("conversationId", conversationId);

  const response = await fetch(`${VOICE_API_URL}/voice/message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new VoiceApiError(
      typeof data.error === "string" ? data.error : "Request failed.",
      response.status
    );
  }

  return data as VoiceResponse;
};

export const getMessages = (token: string, conversationId: string) =>
  voiceRequest<{ messages: Message[] }>(
    `/voice/messages?conversationId=${conversationId}`,
    { token }
  );

export const getAudioUrl = (messageId: string) =>
  `${VOICE_API_URL}/voice/audio/${messageId}`;

export type { Message, VoiceResponse };

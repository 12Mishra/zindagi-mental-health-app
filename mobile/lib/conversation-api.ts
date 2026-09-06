import { Platform } from 'react-native';

const API_URL = Platform.OS === 'web'
  ? 'http://localhost:4000'
  : (process.env.EXPO_PUBLIC_API_URL ?? 'http://172.16.39.185:4000');

type ApiRequestOptions = {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  token?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}) {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      `Unable to reach backend at ${API_URL}. Check that the server is running and EXPO_PUBLIC_API_URL is correct.`,
      0,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      typeof data.error === 'string' ? data.error : 'Request failed.',
      response.status,
    );
  }

  return data as T;
}

export const startConversation = (token: string, moodBefore: string[], moodNote?: string) =>
  apiRequest<{ id: string; status: string }>('/api/conversations', {
    method: 'POST',
    token,
    body: { moodBefore, moodNote },
  });

export const sendMessage = (token: string, conversationId: string, text: string) =>
  apiRequest<{ response: string; turnNumber: number }>(`/api/conversations/${conversationId}/message`, {
    method: 'POST',
    token,
    body: { content: text, text },
  });

export const endConversation = (token: string, conversationId: string) =>
  apiRequest<{ summary: string; keyThemes: string[] }>(`/api/conversations/${conversationId}/end`, {
    method: 'POST',
    token,
  });

export const transcribeAudio = async (token: string, audioUri: string) => {
  // Upload audio file as multipart form data
  const formData = new FormData();
  formData.append('audio', {
    uri: audioUri,
    type: 'audio/m4a',
    name: 'recording.m4a',
  } as any);
  
  // Use fetch directly for multipart
  const response = await fetch(`${API_URL}/api/audio/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  return response.json() as Promise<{ text: string }>;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
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
  if (!API_URL) throw new ApiError('EXPO_PUBLIC_API_URL is not configured.', 0);
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

export const startConversation = (token: string, moodBefore: string[], moodNote?: string, transcriptConsent = false) =>
  apiRequest<{ id: string; status: string }>('/api/conversations', {
    method: 'POST',
    token,
    body: { moodBefore, moodNote, transcriptConsent },
  });

export const sendMessage = (token: string, conversationId: string, text: string) =>
  apiRequest<{ response: string; turnNumber: number }>(`/api/conversations/${conversationId}/message`, {
    method: 'POST',
    token,
    body: { content: text, text },
  });

export const endConversation = (token: string, conversationId: string) =>
  apiRequest<{ summaryStatus: string }>(`/api/conversations/${conversationId}/end`, {
    method: 'POST',
    token,
  });

export const issueVoiceTicket = (token: string, conversationId: string) =>
  apiRequest<{ ticket: string; expiresAt: string }>(`/api/conversations/${conversationId}/voice-ticket`, {
    method: 'POST', token,
  });

export const deleteConversation = (token: string, conversationId: string) =>
  apiRequest<void>(`/api/conversations/${conversationId}`, { method: 'DELETE', token });

export type SavedConversation = {
  id: string;
  createdAt: string;
  endedAt: string | null;
  summary: { summary: string; keyThemes: string[] } | null;
  summaryJob: { state: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' } | null;
};

export const getSavedConversations = (token: string) =>
  apiRequest<SavedConversation[]>('/api/users/me/conversations?limit=20', { token });

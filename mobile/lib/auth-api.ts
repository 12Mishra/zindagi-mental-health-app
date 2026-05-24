// const DEFAULT_API_URL = Platform.OS === 'android'
//   ? 'http://10.0.2.2:4000'
//   : 'http://localhost:4000';

// const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
const API_URL = "http://172.16.36.95:4000";

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

type AuthResponse = {
  user: {
    id: string;
    phoneNumber: string;
    fullName: string;
  };
  session: {
    token: string;
    expiresAt: string;
  };
};

export const sendOtp = (phoneNumber: string) =>
  apiRequest<{
    message: string;
    phoneNumber: string;
    otp?: string;
    expiresInMinutes: number;
    registrationRequired: boolean;
  }>('/auth/send-otp', {
    method: 'POST',
    body: { phoneNumber },
  });

export const loginWithOtp = (phoneNumber: string, otp: string) =>
  apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { phoneNumber, otp },
  });

export const registerWithOtp = (body: {
  phoneNumber: string;
  otp: string;
  fullName: string;
  age: number;
  college: string;
  sex: string;
  history: string[];
}) =>
  apiRequest<AuthResponse & { wasRegistered: boolean }>('/auth/register', {
    method: 'POST',
    body,
  });

export const logout = (token: string) =>
  apiRequest<void>('/auth/logout', {
    method: 'POST',
    token,
  });

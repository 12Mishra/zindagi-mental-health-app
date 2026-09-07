type AuthUser = {
  id: string;
  phoneNumber: string;
  fullName: string;
};

type AuthSession = {
  token: string;
  expiresAt: string;
};

type AuthData = {
  user: AuthUser;
  session: AuthSession;
} | null;

const STORAGE_KEY = 'zindagi_auth_session';

const loadSavedAuth = (): AuthData => {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
  }
  return null;
};

let currentAuth: AuthData = loadSavedAuth();

export const setAuthSession = (auth: AuthData) => {
  currentAuth = auth;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (auth) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }
};

export const getAuthSession = () => {
  if (!currentAuth) {
    currentAuth = loadSavedAuth();
  }
  return currentAuth;
};

export const clearAuthSession = () => {
  currentAuth = null;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
};

import { useSyncExternalStore } from 'react';

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

// Screens that guard on the session re-render (and redirect) the moment it is set or cleared.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

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
  notify();
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
  notify();
};

/** A session counts only while it has a token that has not passed its expiry. */
export const isAuthSessionValid = (auth: AuthData) => {
  if (!auth?.session.token) return false;
  const expiresAt = Date.parse(auth.session.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt > Date.now();
};

/** The current session, kept in sync with setAuthSession/clearAuthSession. */
export const useAuthSession = () => useSyncExternalStore(subscribe, getAuthSession, getAuthSession);

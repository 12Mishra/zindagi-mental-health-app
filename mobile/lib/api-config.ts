import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Backend URLs for every platform.
 *
 * On a phone, "localhost" is the phone itself, so a .env pointing at localhost:4000 can never reach the dev machine.
 * In development, Expo Go and dev builds load the JS bundle from the computer running Metro, and expo-constants
 * reports that address (hostUri, e.g. "192.168.1.20:8082"). We swap localhost for that host, so the app follows
 * the computer's current Wi-Fi IP without editing .env each time it changes.
 *
 * A URL in .env that names a real host (a LAN IP, a tunnel, a deployed API) is used as-is.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

/** Host (no port) of the computer serving the JS bundle, or null when not running from a dev server. */
function devMachineHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? null;
  if (!hostUri) return null;
  const host = hostUri.replace(/^[a-z]+:\/\//i, '').split('/')[0].replace(/:\d+$/, '');
  return host && !LOOPBACK.has(host) ? host : null;
}

function resolveForDevice(url: string): string {
  if (Platform.OS === 'web') return url;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  if (!LOOPBACK.has(parsed.hostname)) return url;
  // EXPO_PUBLIC_API_HOST is an optional manual override (e.g. when the phone reaches Metro through a tunnel).
  const host = devMachineHost() ?? process.env.EXPO_PUBLIC_API_HOST ?? null;
  if (!host) return url;
  parsed.hostname = host;
  return parsed.toString().replace(/\/$/, '');
}

export const API_URL = resolveForDevice(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000');
export const VOICE_WS_URL = resolveForDevice(process.env.EXPO_PUBLIC_VOICE_WS_URL ?? 'ws://localhost:4001/voice');

/** ws(s)://host + path on the API server. */
export const apiSocketUrl = (path: string) => API_URL.replace(/^http/, 'ws').replace(/\/$/, '') + path;

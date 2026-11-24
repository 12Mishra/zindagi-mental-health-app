import { useEffect, useRef, useState } from 'react';
import { apiSocketUrl } from '@/lib/api-config';
import { apiRequest } from '@/lib/conversation-api';
import { getAuthSession } from '@/lib/auth-session';

export type ChatRole = 'STUDENT' | 'THERAPIST';
export type ChatMessage = { id: string; threadId: string; from: ChatRole; body: string; clientId: string | null; createdAt: string };
export type ChatThread = {
  id: string; title: string; subtitle: string | null; counterpartId: string | null;
  lastMessage: { from: ChatRole; body: string; createdAt: string } | null; lastMessageAt: string | null; unread: number;
};
export type ChatContact = { therapistId: string; name: string; threadId: string | null };
export type ChatPage = {
  thread: { id: string; title: string; subtitle: string | null; otherLastReadAt: string | null };
  messages: ChatMessage[]; hasMore: boolean;
};
export type ChatEvent =
  | { type: 'message'; threadId: string; message: ChatMessage }
  | { type: 'read'; threadId: string; by: ChatRole; at: string }
  | { type: 'typing'; threadId: string; by: ChatRole }
  | { type: 'thread'; threadId: string };

export const MAX_BODY = 2000;
const base = '/api/chat';

export const listChatThreads = (token: string) => apiRequest<ChatThread[]>(`${base}/threads`, { token });
export const listChatContacts = (token: string) => apiRequest<ChatContact[]>(`${base}/contacts`, { token });
export const openChatThread = (token: string, therapistId: string) =>
  apiRequest<{ threadId: string }>(`${base}/threads`, { method: 'POST', token, body: { therapistId } });
export const getChatPage = (token: string, threadId: string, before?: string) =>
  apiRequest<ChatPage>(`${base}/threads/${threadId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`, { token });
export const sendChatMessage = (token: string, threadId: string, body: string, clientId: string) =>
  apiRequest<{ message: ChatMessage; safety: 'URGENT' | null }>(`${base}/threads/${threadId}/messages`, { method: 'POST', token, body: { body, clientId } });
export const markChatRead = (token: string, threadId: string) => apiRequest<{ ok: true }>(`${base}/threads/${threadId}/read`, { method: 'POST', token });
const getTicket = (token: string) => apiRequest<{ ticket: string; path: string }>(`${base}/ticket`, { method: 'POST', token });

export const newClientId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** ws(s)://host/chat/ws on the API server (resolved for phones, see api-config). */
const socketUrl = apiSocketUrl;

type Listener = (e: ChatEvent) => void;

/**
 * One shared socket for the whole app, opened while at least one screen subscribes. Reconnects with
 * backoff; after a reconnect every subscriber's `onReconnect` runs so it can refetch what it missed.
 */
class ChatSocket {
  private ws: WebSocket | null = null;
  private subs = new Set<{ onEvent: Listener; onReconnect: () => void; onState: (s: SocketState) => void }>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  state: SocketState = 'offline';

  subscribe(sub: { onEvent: Listener; onReconnect: () => void; onState: (s: SocketState) => void }) {
    this.subs.add(sub);
    sub.onState(this.state);
    if (this.subs.size === 1) void this.connect();
    return () => {
      this.subs.delete(sub);
      if (!this.subs.size) this.stop();
    };
  }

  send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  private setState(s: SocketState) { this.state = s; for (const x of this.subs) x.onState(s); }

  private async connect() {
    if (!this.subs.size) return;
    const token = getAuthSession()?.session.token;
    if (!token) return;
    this.setState(this.attempt === 0 ? 'connecting' : 'offline');
    let ticket: { ticket: string; path: string };
    try { ticket = await getTicket(token); } catch { this.retry(); return; }
    if (!this.subs.size) return;
    const ws = new WebSocket(socketUrl(ticket.path));
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket: ticket.ticket }));
    ws.onmessage = m => {
      let e: { type?: string } | null = null;
      try { e = JSON.parse(String(m.data)); } catch { return; }
      if (e?.type === 'ready') {
        const reconnected = this.attempt > 0;
        this.attempt = 0;
        this.setState('live');
        if (reconnected) for (const x of this.subs) x.onReconnect();
        return;
      }
      if (e?.type) for (const x of this.subs) x.onEvent(e as ChatEvent);
    };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.retry(); } };
  }

  private retry() {
    if (!this.subs.size) return;
    this.attempt++;
    this.setState('offline');
    this.timer = setTimeout(() => void this.connect(), Math.min(15_000, 500 * 2 ** this.attempt));
  }

  private stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.attempt = 0;
    this.state = 'offline';
  }
}

export type SocketState = 'connecting' | 'live' | 'offline';
export const chatSocket = new ChatSocket();

/** Subscribes the calling screen to chat events while it is mounted. */
export function useChatEvents(onEvent: Listener, onReconnect: () => void = () => {}) {
  const [state, setState] = useState<SocketState>(chatSocket.state);
  const ref = useRef({ onEvent, onReconnect });
  useEffect(() => { ref.current = { onEvent, onReconnect }; });
  useEffect(() => chatSocket.subscribe({
    onEvent: e => ref.current.onEvent(e),
    onReconnect: () => ref.current.onReconnect(),
    onState: setState,
  }), []);
  return state;
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const dayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
export const fmtMsgTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtMsgDay = (iso: string) => dayFmt.format(new Date(iso));
export const dayOf = (iso: string | Date) => keyFmt.format(new Date(iso));

'use client';

import { useEffect, useRef, useState } from 'react';
import { chatTicket } from './actions';

export type SocketState = 'connecting' | 'live' | 'offline';
export type ChatSocketEvent =
  | { type: 'message'; threadId: string; message: import('./types').ChatMessage }
  | { type: 'read'; threadId: string; by: 'STUDENT' | 'THERAPIST'; at: string }
  | { type: 'typing'; threadId: string; by: 'STUDENT' | 'THERAPIST' }
  | { type: 'thread'; threadId: string };

/** Core's socket URL as seen by the browser. Override with NEXT_PUBLIC_CORE_WS_URL when core is not on localhost. */
const WS_URL = process.env.NEXT_PUBLIC_CORE_WS_URL ?? 'ws://localhost:4000/chat/ws';

/**
 * Keeps one authenticated chat socket open, reconnecting with backoff. `onReconnect` runs after every
 * reconnect (not the first connect) so the caller can refetch anything pushed while it was offline.
 */
export function useChatSocket(onEvent: (e: ChatSocketEvent) => void, onReconnect: () => void) {
  const [state, setState] = useState<SocketState>('connecting');
  const socket = useRef<WebSocket | null>(null);
  const handlers = useRef({ onEvent, onReconnect });
  useEffect(() => { handlers.current = { onEvent, onReconnect }; });

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      if (stopped) return;
      setState(attempt === 0 ? 'connecting' : 'offline');
      const ticket = await chatTicket().catch(() => null);
      if (stopped) return;
      if (!ticket?.ok) { retry(); return; }
      const ws = new WebSocket(WS_URL);
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket: ticket.data.ticket }));
      ws.onmessage = (m) => {
        let e: { type?: string } | null = null;
        try { e = JSON.parse(String(m.data)); } catch { return; }
        if (e?.type === 'ready') {
          if (attempt > 0) handlers.current.onReconnect();
          attempt = 0;
          setState('live');
          return;
        }
        if (e?.type) handlers.current.onEvent(e as ChatSocketEvent);
      };
      ws.onclose = () => { if (socket.current === ws) socket.current = null; if (!stopped) retry(); };
    };
    const retry = () => {
      attempt++;
      setState('offline');
      timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** attempt));
    };
    void connect();
    return () => { stopped = true; clearTimeout(timer); socket.current?.close(); };
  }, []);

  const send = (data: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(data));
  };
  return { state, send };
}

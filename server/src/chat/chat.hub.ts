import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { createSessionToken, hashValue } from '../auth/utils/crypto.util';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

/**
 * Realtime delivery for chat. The socket only pushes events (new message, read receipt, typing);
 * sending and history go through REST, so a dropped socket never loses a message: clients refetch on reconnect.
 *
 * Auth: the client first fetches a one-time ticket over authenticated REST, then sends it as the first
 * socket frame. Tokens never appear in URLs, and the therapist portal's httpOnly token never reaches the browser.
 *
 * State is in-process (tickets and open sockets). Fine for one API process; with several, fan out through
 * Postgres LISTEN/NOTIFY as the alert stream does.
 */

export type ChatPrincipal = { role: 'STUDENT' | 'THERAPIST'; id: string };
export type ChatEvent =
  | { type: 'message'; threadId: string; message: unknown }
  | { type: 'read'; threadId: string; by: ChatPrincipal['role']; at: string }
  | { type: 'typing'; threadId: string; by: ChatPrincipal['role'] }
  | { type: 'thread'; threadId: string };

export const CHAT_WS_PATH = '/chat/ws';
const TICKET_MS = 60_000;
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 25_000;
const TYPING_MIN_GAP_MS = 1_500;

const tickets = new Map<string, { principal: ChatPrincipal; expiresAt: number }>();
const sockets = new Map<string, Set<WebSocket>>();
const keyOf = (p: ChatPrincipal) => `${p.role}:${p.id}`;

/** Resolves the other participant of a thread the principal belongs to, or null. Injected by the service. */
type CounterpartLookup = (principal: ChatPrincipal, threadId: string) => Promise<ChatPrincipal | null>;
let counterpartOf: CounterpartLookup = async () => null;
export const setCounterpartLookup = (fn: CounterpartLookup) => { counterpartOf = fn; };

export function issueChatTicket(principal: ChatPrincipal) {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.expiresAt <= now) tickets.delete(k);
  const ticket = createSessionToken();
  tickets.set(hashValue(ticket), { principal, expiresAt: now + TICKET_MS });
  return { ticket, expiresAt: new Date(now + TICKET_MS).toISOString(), path: CHAT_WS_PATH };
}

function consumeTicket(ticket: unknown): ChatPrincipal | null {
  if (typeof ticket !== 'string' || ticket.length < 20 || ticket.length > 256) return null;
  const key = hashValue(ticket);
  const t = tickets.get(key);
  tickets.delete(key); // one use, valid or not
  return t && t.expiresAt > Date.now() ? t.principal : null;
}

/** Delivers an event to every open socket of this principal (they may have several devices or tabs). */
export function publish(principal: ChatPrincipal, event: ChatEvent) {
  const set = sockets.get(keyOf(principal));
  if (!set) return;
  const data = JSON.stringify(event);
  for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

export const isOnline = (principal: ChatPrincipal) => (sockets.get(keyOf(principal))?.size ?? 0) > 0;

function parse(raw: RawData): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw.toString().slice(0, 4096));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

/** Attaches the chat socket to the API's HTTP server. Other upgrade paths are left alone. */
export function attachChatSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== CHAT_WS_PATH) return;
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket & { alive?: boolean }) => {
    let principal: ChatPrincipal | null = null;
    let lastTyping = 0;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const authTimer = setTimeout(() => { if (!principal) ws.close(4401, 'auth timeout'); }, AUTH_TIMEOUT_MS);

    ws.on('message', async raw => {
      const msg = parse(raw);
      if (!msg) return;
      if (!principal) {
        if (msg.type !== 'auth') { ws.close(4401, 'auth required'); return; }
        principal = consumeTicket(msg.ticket);
        clearTimeout(authTimer);
        if (!principal) { ws.close(4401, 'invalid ticket'); return; }
        const key = keyOf(principal);
        if (!sockets.has(key)) sockets.set(key, new Set());
        sockets.get(key)!.add(ws);
        ws.send(JSON.stringify({ type: 'ready' }));
        return;
      }
      if (msg.type === 'typing' && typeof msg.threadId === 'string') {
        const now = Date.now();
        if (now - lastTyping < TYPING_MIN_GAP_MS) return;
        lastTyping = now;
        const other = await counterpartOf(principal, msg.threadId).catch(() => null);
        if (other) publish(other, { type: 'typing', threadId: msg.threadId, by: principal.role });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!principal) return;
      const set = sockets.get(keyOf(principal));
      set?.delete(ws);
      if (set && !set.size) sockets.delete(keyOf(principal));
    });
    ws.on('error', () => ws.terminate());
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}

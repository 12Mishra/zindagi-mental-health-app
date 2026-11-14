import type { Response } from 'express';
import { Client } from 'pg';
import { config } from '../config';
import { ALERT_CHANNEL } from './alerts';

type Listener = { institutionId: string; res: Response };
const listeners = new Set<Listener>();
let client: Client | null = null;
let connecting = false;

function reconnectLater() {
  setTimeout(() => { if (listeners.size) void ensureListening(); }, 3000).unref();
}

/** One shared Postgres LISTEN connection for the whole API process; started lazily and re-established on failure. */
async function ensureListening(): Promise<void> {
  if (client || connecting) return;
  connecting = true;
  const next = new Client({ connectionString: config.databaseUrl });
  try {
    next.on('notification', message => {
      let event: { type?: string; institutionId?: string; alert?: unknown };
      try { event = JSON.parse(message.payload ?? ''); } catch { return; }
      for (const l of listeners) {
        if (l.institutionId === event.institutionId) l.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.alert)}\n\n`);
      }
    });
    const drop = () => { if (client === next) client = null; reconnectLater(); };
    next.on('error', drop);
    next.on('end', drop);
    await next.connect();
    await next.query(`LISTEN ${ALERT_CHANNEL}`);
    client = next;
  } catch {
    void next.end().catch(() => {});
    reconnectLater();
  } finally { connecting = false; }
}

/** Streams alert events for one institution to a response as server-sent events. Returns when the client disconnects. */
export function attachAlertStream(institutionId: string, res: Response): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  const listener: Listener = { institutionId, res };
  listeners.add(listener);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => { clearInterval(heartbeat); listeners.delete(listener); });
  void ensureListening();
}

import Redis from 'ioredis';
import { config } from '../config';

/** The small Redis surface the memory tiers use; tests inject an in-memory fake. */
export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlS?: number): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, values: Record<string, string>): Promise<void>;
  expire(key: string, ttlS: number): Promise<void>;
  del(key: string): Promise<void>;
}

export const key = (...parts: string[]) => `zs:${parts.join(':')}`;

class RedisKv implements Kv {
  constructor(private readonly redis: Redis) {}

  /** With no offline queue, a command sent while the first connection is still opening would fail; wait for it once. */
  private async ready() {
    const { status } = this.redis;
    if (status === 'ready' || status === 'end' || status === 'reconnecting') return;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.redis.off('ready', done); this.redis.off('error', done); resolve(); };
      const timer = setTimeout(done, 1500);
      this.redis.once('ready', done);
      this.redis.once('error', done);
    });
  }

  async get(k: string) { await this.ready(); return this.redis.get(k); }
  async set(k: string, value: string, ttlS?: number) { await this.ready(); if (ttlS) await this.redis.set(k, value, 'EX', ttlS); else await this.redis.set(k, value); }
  async hgetall(k: string) { await this.ready(); return this.redis.hgetall(k); }
  async hset(k: string, values: Record<string, string>) { await this.ready(); await this.redis.hset(k, values); }
  async expire(k: string, ttlS: number) { await this.ready(); await this.redis.expire(k, ttlS); }
  async del(k: string) { await this.ready(); await this.redis.del(k); }
}

let override: Kv | null | undefined;
let shared: Kv | null | undefined;
let lastWarn = 0;

/** Test hook: `undefined` restores the configured Redis client. */
export function setKv(kv: Kv | null | undefined) { override = kv; }

export function getKv(): Kv | null {
  if (override !== undefined) return override;
  if (shared !== undefined) return shared;
  if (!config.redisUrl) { shared = null; return shared; }
  // No offline queue: when Redis is down commands fail at once instead of stalling a turn.
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1500 });
  redis.on('error', () => warn('redis_error'));
  shared = new RedisKv(redis);
  return shared;
}

function warn(code: string) {
  if (Date.now() - lastWarn < 30_000) return;
  lastWarn = Date.now();
  console.warn(`[memory] ${code}`);
}

/** Runs one Redis operation; any failure degrades to `fallback` and never throws into a turn. */
export async function safe<T>(op: (kv: Kv) => Promise<T>, fallback: T): Promise<T> {
  const kv = getKv();
  if (!kv) { warn('session_memory_unavailable'); return fallback; }
  try { return await op(kv); } catch { warn('session_memory_unavailable'); return fallback; }
}

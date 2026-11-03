import type { Kv } from './redis';

/** In-memory Kv for tests; `down()` makes every call reject like an unreachable Redis. */
export class FakeKv implements Kv {
  readonly strings = new Map<string, string>();
  readonly hashes = new Map<string, Record<string, string>>();
  failing = false;
  private check() { if (this.failing) throw new Error('redis_down'); }
  async get(key: string) { this.check(); return this.strings.get(key) ?? null; }
  async set(key: string, value: string) { this.check(); this.strings.set(key, value); }
  async hgetall(key: string) { this.check(); return { ...(this.hashes.get(key) ?? {}) }; }
  async hset(key: string, values: Record<string, string>) { this.check(); this.hashes.set(key, { ...(this.hashes.get(key) ?? {}), ...values }); }
  async expire() { this.check(); }
  async del(key: string) { this.check(); this.strings.delete(key); this.hashes.delete(key); }
}

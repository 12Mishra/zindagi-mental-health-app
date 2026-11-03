import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { config } from '../config';
import { parseGreeting } from './context-agent';
import { prepareGreeting, staticGreeting, takeGreeting } from './greeting';
import { mergeLongTerm, parseMerge, type MemoryStore, type MergedMemory } from './long-term';
import { deleteMemory, getMemory, patchPreferences, type MemoryApiStore } from './memory.service';
import { key, setKv } from './redis';
import { FakeKv } from './test-kv';
import { emptyLongTerm, type LongTermMemory, type Preferences } from './types';
import { dot, embed, l2normalize, rank, validateEmbedding } from './vector';
import { jobSource, riskRows, snapshotText } from '../worker/memory-job';
import { cardFromProfile } from '../scripts/migrate-p2-memory';
import { ContextAgent } from './context-agent';

afterEach(() => setKv(undefined));

test('vector rank: cosine top-k on fixed vectors, empty embeddings skipped, threshold applied', () => {
  const q = l2normalize([1, 0]);
  const rows = [
    { id: 'a', summary: 'near', embedding: l2normalize([1, 0.1]) },
    { id: 'b', summary: 'far', embedding: l2normalize([0, 1]) },
    { id: 'c', summary: 'empty', embedding: [] },
    { id: 'd', summary: 'closest', embedding: l2normalize([1, 0]) },
    { id: 'e', summary: 'wrong dim', embedding: [1, 0, 0] },
  ];
  assert.deepEqual(rank(rows, q, 3, 0.75).map(h => h.id), ['d', 'a']);
  assert.equal(rank(rows, q, 1, 0.75).length, 1);
  assert.ok(Math.abs(dot(q, q) - 1) < 1e-9);
});

test('embedding: unconfigured returns null without throwing; wrong dimension rejected', async () => {
  const saved = { url: config.embeddingBaseUrl, model: config.embeddingModel };
  config.embeddingBaseUrl = '';
  config.embeddingModel = '';
  try { assert.equal(await embed('hello'), null); } finally { config.embeddingBaseUrl = saved.url; config.embeddingModel = saved.model; }
  assert.equal(validateEmbedding([1, 2, 3], 4), null);
  assert.deepEqual(validateEmbedding([3, 4], 2)?.map(x => Number(x.toFixed(2))), [0.6, 0.8]);
});

test('greeting: pre-generated line is used; otherwise static within ~300 ms', async () => {
  const kv = new FakeKv();
  setKv(kv);
  kv.strings.set(key('greet', 'g1'), 'Welcome back, how did the interview go?');
  assert.equal(await takeGreeting('g1'), 'Welcome back, how did the interview go?');
  assert.equal(kv.strings.has(key('greet', 'g1')), false);
  const started = Date.now();
  assert.equal(await takeGreeting('g2', 300), null);
  const waited = Date.now() - started;
  assert.ok(waited >= 250 && waited < 450, `waited ${waited}`);
  assert.match(staticGreeting('en'), /Lisa/);
  assert.equal(parseGreeting(JSON.stringify({ greeting: 'one two three' })), 'one two three');
  assert.equal(parseGreeting(JSON.stringify({ greeting: Array(30).fill('w').join(' ') })), null);
});

test('greeting: first-ever session resolves immediately to the static greeting', async () => {
  const kv = new FakeKv();
  setKv(kv);
  kv.strings.set(key('ctx', 'g3'), JSON.stringify(emptyLongTerm()));
  kv.strings.set(key('greet', 'g3'), '__static__');
  const started = Date.now();
  assert.equal(await takeGreeting('g3'), null);
  assert.ok(Date.now() - started < 100);
  void prepareGreeting; void ContextAgent;
});

const memory = (over: Partial<LongTermMemory> = {}): LongTermMemory => ({ ...emptyLongTerm(), ...over });
const merged = (card: string): MergedMemory => ({ memoryCard: card, openThreads: [], preferences: {} });

test('memory merge: version conflict reloads and retries, then succeeds; gives up after 3', async () => {
  let version = 0;
  let stolen = false;
  let computes = 0;
  const saved: string[] = [];
  const store: MemoryStore = {
    async load() { return memory({ version, memoryCard: `v${version}` }); },
    async save(_user, expected, next) {
      if (!stolen) { stolen = true; version++; return false; } // another writer got in first
      if (expected !== version) return false;
      version++; saved.push(next.memoryCard); return true;
    },
  };
  assert.equal(await mergeLongTerm('u', async current => { computes++; return merged(`based on ${current.memoryCard}`); }, store), true);
  assert.equal(computes, 2);
  assert.deepEqual(saved, ['based on v1']);
  const never: MemoryStore = { load: async () => memory(), save: async () => false };
  assert.equal(await mergeLongTerm('u', async () => merged('x'), never), false);
});

test('parseMerge validates shapes and lengths', () => {
  const current = memory({ openThreads: [{ id: 't1', text: 'placements', createdAt: '2026-01-01', lastMentionedAt: '2026-01-01', status: 'open' }] });
  const ok = parseMerge(JSON.stringify({ memoryCard: '- a\n- b', openThreads: [{ id: 't1', text: 'placements', status: 'resolved' }], preferences: { language: 'hi' } }), current);
  assert.equal(ok?.openThreads[0].id, 't1');
  assert.equal(ok?.openThreads[0].createdAt, '2026-01-01');
  assert.equal(ok?.preferences.language, 'hi');
  assert.equal(parseMerge(JSON.stringify({ memoryCard: 'x'.repeat(1300), openThreads: [], preferences: {} }), current), null);
  assert.equal(parseMerge(JSON.stringify({ memoryCard: Array(13).fill('- b').join('\n'), openThreads: [], preferences: {} }), current), null);
  assert.equal(parseMerge('nope', current), null);
});

test('worker: memory-only jobs use the snapshot, transcript jobs the transcript; risk rows are additive', () => {
  assert.equal(jobSource({ transcriptConsent: false, memoryConsent: true }, { rollingSummary: 'x' }), 'snapshot');
  assert.equal(jobSource({ transcriptConsent: false, memoryConsent: true }, null), null);
  assert.equal(jobSource({ transcriptConsent: true, memoryConsent: true }, { rollingSummary: 'x' }), 'transcript');
  assert.equal(jobSource({ transcriptConsent: false, memoryConsent: false }, { rollingSummary: 'x' }), null);
  assert.match(snapshotText({ rollingSummary: 'sum', notes: { stressors: ['placements'] } }), /stressors: placements/);
  const rows = riskRows(['hopelessness_mentioned'], { riskTimeline: [{ turn: 1, level: 'LOW', at: 0 }, { turn: 2, level: 'URGENT', at: 0 }, { turn: 3, level: 'URGENT', at: 0 }] });
  assert.deepEqual(rows.map(r => `${r.level}:${r.flag}`), ['UNKNOWN:hopelessness_mentioned', 'URGENT:triage_urgent']);
});

class FakeApiStore implements MemoryApiStore {
  readonly data = new Map<string, LongTermMemory>([['alice', memory({ memoryCard: '- alice card' })], ['bob', memory({ memoryCard: '- bob card' })]]);
  async read(userId: string) { return this.data.get(userId) ?? emptyLongTerm(); }
  async wipe(userId: string) { this.data.delete(userId); }
  async savePreferences(userId: string, preferences: Preferences) { this.data.set(userId, { ...(await this.read(userId)), preferences }); }
}

test('/api/memory is scoped to the authenticated user', async () => {
  setKv(new FakeKv());
  const store = new FakeApiStore();
  assert.equal((await getMemory('alice', store)).memoryCard, '- alice card');
  await deleteMemory('alice', store);
  assert.equal((await getMemory('alice', store)).memoryCard, '');
  assert.equal((await getMemory('bob', store)).memoryCard, '- bob card');
  assert.equal(await patchPreferences('bob', { language: 'klingon' }, store), 'language must be en, hi or mixed.');
  assert.equal(await patchPreferences('bob', { language: 'hi', declinedExercises: ['breathing'] }, store), null);
  assert.equal((await getMemory('bob', store)).preferences.language, 'hi');
  assert.equal((await getMemory('alice', store)).preferences.language, undefined);
});

test('migration card: deduped, at most 12 bullets and 1,200 chars', () => {
  const card = cardFromProfile(['Exams', 'exams', 'Sleep'], Array.from({ length: 30 }, (_, i) => `keyword ${i} ${'x'.repeat(120)}`));
  const lines = card.split('\n');
  assert.ok(lines.length <= 12);
  assert.ok(card.length <= 1200);
  assert.equal(lines.filter(l => /exams/i.test(l)).length, 1);
});

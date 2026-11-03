import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { config } from '../config';
import { ContextAgent, PartialBriefer, parseBrief, parseNotesUpdate, type Complete } from './context-agent';
import { setKv } from './redis';
import { SessionContext } from './session-context';
import { loadSession } from './session-memory';
import { FakeKv } from './test-kv';
import { emptyNotes } from './types';

afterEach(() => setKv(undefined));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const none = async () => [];

test('rolling summary folds overflow turns and nothing is lost (fake agent records inputs)', async () => {
  setKv(new FakeKv());
  const seen: string[] = [];
  const complete: Complete = async messages => {
    const user = messages[1].content;
    seen.push(user);
    return JSON.stringify({ notes: { topics: ['t'] }, rollingSummary: `summary after ${seen.length}` });
  };
  const ctx = new SessionContext('c1', 'u1', 'POLICY', undefined, { agent: new ContextAgent(complete), recall: none });
  for (let i = 1; i <= 7; i++) {
    const turn = ctx.addUser(`student fact ${i}`);
    ctx.addAssistant(turn, () => `lisa reply ${i}`);
    await ctx.afterTurn();
  }
  const folded = seen.filter(s => s.includes('<untrusted label="overflow">')).join('\n');
  for (const fact of ['student fact 1', 'student fact 2', 'student fact 3']) assert.match(folded, new RegExp(fact));
  const prompt = ctx.build();
  assert.equal(prompt.messages.filter(m => m.role !== 'system').length <= config.workingTurns, true);
  assert.match(prompt.messages[0].content, /earlier in this chat: summary after/);
  assert.equal(prompt.messages[prompt.messages.length - 1].content, 'student fact 7');
});

test('late reply of an interrupted turn is inserted before the next student turn', () => {
  const ctx = new SessionContext('c2', 'u1', 'POLICY');
  const first = ctx.addUser('one');
  ctx.addUser('two');
  ctx.addAssistant(first, () => 'heard part');
  const roles = ctx.build().messages.slice(1).map(m => m.content);
  assert.deepEqual(roles, ['one', 'heard part', 'two']);
});

test('debounce: rapid partials start at most one in-flight call; cancel invalidates stale results', async () => {
  let calls = 0;
  let release: () => void = () => {};
  let clock = 0;
  const briefer = new PartialBriefer(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); }, () => clock);
  const text = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  assert.equal(briefer.onPartial(text(3)), false);
  clock = 1000;
  assert.equal(briefer.onPartial(text(7)), true);
  clock = 2000;
  assert.equal(briefer.onPartial(text(20)), false, 'in flight');
  assert.equal(calls, 1);
  const epoch = briefer.epoch;
  briefer.cancel();
  assert.notEqual(briefer.epoch, epoch);
  release();
  await sleep(5);
  clock = 3000;
  assert.equal(briefer.onPartial(text(7)), true);
});

test('invalid or oversized agent JSON is ignored', () => {
  assert.equal(parseBrief('not json', 1), null);
  assert.equal(parseBrief(JSON.stringify({ intent: 'x'.repeat(500), lang: 'en', recall: [], emotionHint: '', avoid: [], suggestedFocus: '' }), 1), null);
  assert.ok(parseBrief(JSON.stringify({ intent: 'ok', lang: 'hi', recall: ['a'], emotionHint: 'tired', avoid: [], suggestedFocus: 'sleep' }), 3));
  assert.equal(parseNotesUpdate(JSON.stringify({ notes: { topics: 'nope' } }), emptyNotes()), null);
});

test('a slow context agent never blocks the turn: prompt is built at once without a brief', async () => {
  setKv(new FakeKv());
  const slow: Complete = () => new Promise(resolve => setTimeout(() => resolve(null), 5000));
  const ctx = new SessionContext('c3', 'u1', 'POLICY', undefined, { agent: new ContextAgent(slow), recall: none });
  ctx.onPartial('I have been feeling really stressed about my placements lately');
  const started = Date.now();
  ctx.addUser('I have been feeling really stressed about my placements lately');
  const prompt = ctx.build();
  assert.ok(Date.now() - started < 50);
  assert.doesNotMatch(prompt.messages[0].content, /<turn_brief>/);
  assert.ok(prompt.promptBuildMs < 15);
});

test('Redis down: turn is still answered and nothing throws', async () => {
  const kv = new FakeKv();
  kv.failing = true;
  setKv(kv);
  const ctx = await SessionContext.open('c4', 'u1', 'POLICY', { agent: new ContextAgent(null), recall: none }).catch(() => null);
  assert.ok(ctx);
  const turn = ctx.addUser('hello');
  ctx.addAssistant(turn, () => 'hi');
  ctx.recordRisk('LOW');
  await ctx.afterTurn();
  assert.equal(ctx.build().messages.slice(-1)[0].content, 'hello');
  assert.equal(await loadSession('c4'), null);
  await ctx.close();
});

test('close writes the snapshot to the session tier', async () => {
  const kv = new FakeKv();
  setKv(kv);
  const ctx = new SessionContext('c5', 'u1', 'POLICY');
  const turn = ctx.addUser('मुझे नींद नहीं आती');
  ctx.addAssistant(turn, () => 'ok');
  await ctx.afterTurn();
  const snapshot = await ctx.close();
  assert.equal(snapshot.turnCount, 1);
  assert.equal((await loadSession('c5'))?.language, 'hi');
});

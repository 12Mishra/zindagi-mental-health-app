import assert from 'node:assert/strict';
import test from 'node:test';
import { SAFETY_CLARIFICATION, URGENT_SUPPORT, type Review, type Triage } from './policy';
import { TurnTrace } from './trace';
import { TurnRunner, type TurnDeps } from './turn';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const LOW: Triage = { level: 'LOW', action: 'continue' };

type Harness = { events: Array<{ type: string } & Record<string, unknown>>; log: string[]; audio: Buffer[] };

/** Fake LLM/TTS/triage with controllable timing; records events and TTS start/finish order. */
function harness(options: {
  tokens?: string[]; tokenDelayMs?: number; triage?: () => Promise<Triage>;
  review?: (text: string) => Promise<Review>; ttsChunks?: number; ttsChunkDelayMs?: number;
}) {
  const h: Harness = { events: [], log: [], audio: [] };
  const deps: TurnDeps = {
    async *streamLlm(signal, hooks) {
      hooks.onRequestSent();
      for (const token of options.tokens ?? []) {
        await wait(options.tokenDelayMs ?? 1);
        if (signal.aborted) return;
        yield token;
      }
    },
    triage: options.triage ?? (async () => LOW),
    review: options.review ?? (async () => ({ decision: 'ALLOW', reasonCode: 'ok' })),
    async synthesize(text, index, onChunk, signal) {
      h.log.push(`tts_start:${index}`);
      for (let i = 0; i < (options.ttsChunks ?? 3); i++) {
        await wait(options.ttsChunkDelayMs ?? 5);
        if (signal.aborted) return;
        onChunk(Buffer.from([index, i]));
      }
      h.log.push(`tts_done:${index}`);
    },
    emit: (type, extra = {}) => { h.events.push({ type, ...extra }); if (type === 'audio_end') h.log.push(`audio_end:${extra.segmentIndex}`); },
    sendAudio: pcm => { h.audio.push(pcm); },
    isCurrent: () => true,
  };
  return { h, deps };
}

const runner = (deps: TurnDeps, regex: Triage = LOW, language: 'en' | 'hi' = 'en', gateMs = 1000) => {
  const abort = new AbortController();
  const turn = new TurnRunner(deps, { language, regex, gateMs, outputReview: 'async', signal: abort.signal, trace: new TurnTrace('t1') });
  return { turn, abort };
};

test('clause 2 synthesis starts before clause 1 audio finishes and segment order is preserved', async () => {
  const { h, deps } = harness({
    tokens: ['That sounds ', 'really hard, ', 'and I am ', 'glad you said it. ', 'Do you want ', 'to tell me more?'],
    ttsChunks: 4, ttsChunkDelayMs: 15,
  });
  const { turn } = runner(deps);
  await turn.run();
  assert.ok(h.log.indexOf('tts_start:1') < h.log.indexOf('tts_done:0'), h.log.join(','));
  const segments = h.events.filter(e => e.type === 'response_text').map(e => e.segmentIndex);
  assert.deepEqual(segments, [0, 1, 2]);
  const audioOrder = h.audio.map(chunk => chunk[0]);
  assert.deepEqual(audioOrder, [...audioOrder].sort());
  const ends = h.events.filter(e => e.type === 'audio_end').map(e => e.segmentIndex);
  assert.deepEqual(ends, [0, 1, 2]);
});

test('gate holds Lisa audio until LLM triage says LOW', async () => {
  let resolveTriage!: (triage: Triage) => void;
  const { h, deps } = harness({ tokens: ['I hear you, ', 'that is a lot. '], triage: () => new Promise(r => { resolveTriage = r; }) });
  const { turn } = runner(deps);
  const running = turn.run();
  await wait(40);
  assert.equal(h.audio.length, 0);
  resolveTriage(LOW);
  await running;
  assert.ok(h.audio.length > 0);
});

test('regex URGENT speaks the fixed support message and never starts Lisa', async () => {
  let llmCalled = false;
  const { h, deps } = harness({ tokens: ['should not play'] });
  deps.streamLlm = async function* () { llmCalled = true; };
  const { turn } = runner(deps, { level: 'URGENT', action: 'local_support_prompt' }, 'hi');
  await turn.run();
  assert.equal(llmCalled, false);
  const texts = h.events.filter(e => e.type === 'response_text').map(e => e.text);
  assert.deepEqual(texts, [URGENT_SUPPORT.hi]);
  assert.match(String(texts[0]), /14416/);
});

test('ELEVATED triage discards held clauses and speaks the clarification instead', async () => {
  const { h, deps } = harness({
    tokens: ['That sounds ', 'really hard, ', 'tell me more.'],
    triage: async () => { await wait(30); return { level: 'ELEVATED', action: 'clarify_safety' }; },
  });
  const { turn } = runner(deps);
  await turn.run();
  const texts = h.events.filter(e => e.type === 'response_text').map(e => e.text);
  assert.deepEqual(texts, [SAFETY_CLARIFICATION.en]);
});

test('late non-LOW triage after timeout release cuts playback, then speaks the policy message', async () => {
  const { h, deps } = harness({
    tokens: ['That sounds ', 'really hard, ', 'and you have ', 'been carrying it ', 'for a long time. '],
    ttsChunks: 10, ttsChunkDelayMs: 10,
    triage: async () => { await wait(60); return { level: 'URGENT', action: 'local_support_prompt' }; },
  });
  const { turn } = runner(deps, LOW, 'en', 5);
  await turn.run();
  const types = h.events.map(e => e.type);
  const cut = types.indexOf('interrupted');
  assert.ok(cut > 0, types.join(','));
  const afterCut = h.events.slice(cut + 1);
  // No Lisa chunks after the cut: the only later audio belongs to the urgent support segment.
  const urgentIndex = h.events.find(e => e.type === 'response_text' && e.text === URGENT_SUPPORT.en)?.segmentIndex;
  assert.notEqual(urgentIndex, undefined);
  for (const event of afterCut) if (event.type === 'audio_chunk') assert.equal(event.segmentIndex, urgentIndex);
});

test('async review BLOCK on a released clause sends interrupted and drops later chunks', async () => {
  const { h, deps } = harness({
    tokens: ['You definitely ', 'need help now, ', 'and this is ', 'what you should do.'],
    ttsChunks: 10, ttsChunkDelayMs: 10,
    review: async text => { await wait(25); return text.startsWith('You') ? { decision: 'BLOCK', reasonCode: 'unsafe' } : { decision: 'ALLOW', reasonCode: 'ok' }; },
  });
  const { turn } = runner(deps, LOW, 'en', 0);
  await turn.run();
  const types = h.events.map(e => e.type);
  const cut = types.indexOf('interrupted');
  assert.ok(cut > 0, types.join(','));
  assert.equal(types.slice(cut + 1).filter(type => type === 'audio_chunk').length, 0);
  assert.equal(turn.blocked, true);
});

test('regex review BLOCK before anything is spoken falls back to the unavailable message', async () => {
  const { h, deps } = harness({ tokens: ['You definitely have depression. ', 'Take 50 mg.'] });
  const { turn } = runner(deps);
  await turn.run();
  const texts = h.events.filter(e => e.type === 'response_text').map(e => String(e.text));
  assert.equal(texts.length, 1);
  assert.match(texts[0], /cannot safely respond/);
});

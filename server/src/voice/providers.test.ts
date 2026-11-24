import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocketServer } from 'ws';

process.env.DATABASE_URL ||= 'postgresql://unused:unused@127.0.0.1:5432/unused';
process.env.DEEPGRAM_API_KEY = 'test-only';
process.env.SARVAM_API_KEY = 'test-only';
process.env.VOICE_SAFETY_BASE_URL = 'http://127.0.0.1:9/v1/';
process.env.VOICE_SAFETY_MODEL = 'test-only';
process.env.VOICE_LLM_BASE_URL = 'http://127.0.0.1:9/v1/';
process.env.VOICE_LLM_MODEL = 'lisa';
// Set before config loads, so a developer's server/.env (dotenv never overrides) cannot change what these tests expect.
process.env.VOICE_LLM_TEMPERATURE = '';
process.env.OPENAI_TEST_API_KEY = '';
process.env.STT_PROVIDER = 'sarvam';
process.env.STT_LANGUAGE = 'auto';

test('Deepgram adapter streams frames and emits partial/final before close', async () => {
  const { DeepgramStream } = await import('./providers');
  const server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const events: string[] = [];
  const frames: Buffer[] = [];
  const connection = once(server, 'connection');
  const stt = new DeepgramStream({
    speechStart: () => events.push('speech_start'),
    partial: text => events.push(`partial:${text}`),
    final: text => events.push(`final:${text}`),
    error: () => {},
  }, `ws://127.0.0.1:${address.port}/listen`);
  try {
    const connected = stt.connect();
    const [peer] = await connection;
    const ws = peer as import('ws');
    ws.on('message', (data, binary) => { if (binary) frames.push(Buffer.from(data as Buffer)); });
    await connected;
    assert.equal(stt.send(Buffer.alloc(640)), true);
    ws.send(JSON.stringify({ type: 'SpeechStarted' }));
    ws.send(JSON.stringify({ type: 'Results', is_final: false, speech_final: false,
      channel: { alternatives: [{ transcript: 'I feel' }] } }));
    ws.send(JSON.stringify({ type: 'Results', is_final: true, speech_final: true,
      channel: { alternatives: [{ transcript: 'I feel ठीक' }] } }));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(events, ['speech_start', 'partial:I feel', 'final:I feel ठीक']);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].length, 640);
  } finally {
    stt.close();
    for (const client of server.clients) client.terminate();
    server.close();
  }
});

test('Deepgram UtteranceEnd ends a turn without speech_final, and is deduped after speech_final', async () => {
  const { DeepgramStream } = await import('./providers');
  const server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const finals: string[] = [];
  let query = '';
  server.on('connection', (_socket, request) => { query = request.url ?? ''; });
  const connection = once(server, 'connection');
  const stt = new DeepgramStream({ speechStart: () => {}, partial: () => {}, final: text => finals.push(text), error: () => {} },
    `ws://127.0.0.1:${address.port}/listen`);
  try {
    const connected = stt.connect();
    const [peer] = await connection;
    const ws = peer as import('ws');
    await connected;
    const result = (transcript: string, speechFinal: boolean) => ws.send(JSON.stringify({ type: 'Results', is_final: true,
      speech_final: speechFinal, channel: { alternatives: [{ transcript }] } }));
    result('hello there', true);
    ws.send(JSON.stringify({ type: 'UtteranceEnd' }));
    result('accha theek', false);
    ws.send(JSON.stringify({ type: 'UtteranceEnd' }));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(finals, ['hello there', 'accha theek']);
    const params = new URL(query, 'ws://x').searchParams;
    assert.equal(params.get('endpointing'), '300');
    assert.equal(params.get('utterance_end_ms'), '1000');
    assert.equal(params.get('smart_format'), 'true');
  } finally {
    stt.close();
    for (const client of server.clients) client.terminate();
    server.close();
  }
});

test('Sarvam STT sends base64 JSON audio and maps VAD/partial/final events, with auto language detection', async () => {
  const { SarvamSttStream } = await import('./providers');
  const server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const events: string[] = [];
  const errors: string[] = [];
  const received: any[] = [];
  let query = '';
  let key = '';
  server.on('connection', (_socket, request) => { query = request.url ?? ''; key = String(request.headers['api-subscription-key'] ?? ''); });
  const connection = once(server, 'connection');
  const stt = new SarvamSttStream({
    speechStart: () => events.push('speech_start'),
    partial: text => events.push(`partial:${text}`),
    final: text => events.push(`final:${text}`),
    error: code => errors.push(code),
  }, `ws://127.0.0.1:${address.port}/speech-to-text-realtime/ws`);
  try {
    const connected = stt.connect();
    const [peer] = await connection;
    const ws = peer as import('ws');
    ws.on('message', data => received.push(JSON.parse(data.toString())));
    await connected;
    assert.equal(stt.send(Buffer.from([1, 2, 3, 4])), true);
    ws.send(JSON.stringify({ event: 'session.begin', request_id: 'r1' }));
    ws.send(JSON.stringify({ event: 'vad.speech_start', utterance_idx: 0 }));
    ws.send(JSON.stringify({ event: 'transcript.partial', utterance_idx: 0, text: 'আমি খুব', language: 'bn-IN' }));
    ws.send(JSON.stringify({ event: 'transcript.final', utterance_idx: 0, text: 'আমি খুব tired', language: 'bn-IN' }));
    ws.send(JSON.stringify({ event: 'error', code: 'slow', is_fatal: false, message: 'non-fatal' }));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(events, ['speech_start', 'partial:আমি খুব', 'final:আমি খুব tired']);
    assert.deepEqual(errors, [], 'non-fatal errors do not end the session');
    assert.deepEqual(received[0], { event: 'audio_input', audio: Buffer.from([1, 2, 3, 4]).toString('base64') });
    assert.equal(key, 'test-only');
    const params = new URL(query, 'ws://x').searchParams;
    assert.equal(params.get('language_code'), 'auto');
    assert.equal(params.get('model'), 'saaras:v4');
    assert.equal(params.get('mode'), 'codemix');
    assert.equal(params.get('sample_rate'), '16000');
    ws.send(JSON.stringify({ event: 'error', code: 'auth', is_fatal: true, message: 'fatal' }));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(errors, ['stt_disconnected']);
  } finally {
    stt.close();
    for (const client of server.clients) client.terminate();
    server.close();
  }
});

test('TTS voice follows the student script: Bengali, Gurmukhi, Devanagari/Roman Hindi, English', async () => {
  const { ttsLanguageCode } = await import('./policy');
  assert.equal(ttsLanguageCode('আমি খুব ক্লান্ত'), 'bn-IN');
  assert.equal(ttsLanguageCode('ਮੈਨੂੰ ਪੇਪਰਾਂ ਦੀ tension ਹੈ'), 'pa-IN');
  assert.equal(ttsLanguageCode('मुझे नींद नहीं आ रही'), 'hi-IN');
  assert.equal(ttsLanguageCode('mujhe exams ka stress hai'), 'hi-IN');
  assert.equal(ttsLanguageCode('I feel stressed about exams'), 'en-IN');
});

test('unchecked Lisa segment fails closed when checker is unavailable', async () => {
  const { checkLisaSegment, assessStudentUtterance } = await import('./safety-classifier');
  const review = await checkLisaSegment('Would you like to talk about it?',
    { level: 'LOW', action: 'continue' }, undefined, 'I feel tired');
  assert.deepEqual(review, { decision: 'UNKNOWN', reasonCode: 'checker_unavailable' });
  const triage = await assessStudentUtterance('I feel tired');
  assert.equal(triage.level, 'UNKNOWN');
});

test('student safety accepts consistent ordinary stress and rejects inconsistent routing', async () => {
  const { assessStudentUtterance } = await import('./safety-classifier');
  const original = globalThis.fetch;
  const reply = (level: string, action: string) => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ level, action, evidence: '', emotion: 'stressed' }) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    globalThis.fetch = async () => reply('LOW', 'continue');
    assert.equal((await assessStudentUtterance('I feel stressed about placements')).level, 'LOW');
    globalThis.fetch = async () => reply('ELEVATED', 'continue');
    assert.deepEqual(await assessStudentUtterance('I feel stressed about placements'),
      { level: 'UNKNOWN', action: 'clarify_safety', evidence: undefined });
  } finally { globalThis.fetch = original; }
});

test('Sarvam adapter streams aligned PCM and rejects mislabeled WAV', async () => {
  const { streamSarvamPcm } = await import('./providers');
  const voice = { languageCode: 'en-IN' as const, speaker: 'shubh' };
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3, 4]),
      { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    const chunks: Buffer[] = [];
    await streamSarvamPcm('Hello', voice, new AbortController().signal, chunk => chunks.push(chunk));
    assert.deepEqual(Buffer.concat(chunks), Buffer.from([1, 2, 3, 4]));
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3, 4]),
      { status: 200, headers: { 'content-type': 'audio/wav' } });
    await assert.rejects(streamSarvamPcm('Hello', voice, new AbortController().signal, () => {}),
      /tts_unexpected_codec/);
  } finally { globalThis.fetch = original; }
});

test('Lisa stream uses the served model sampling settings', async () => {
  const { streamLisa } = await import('./providers');
  const original = globalThis.fetch;
  let sent: Record<string, unknown> | null = null;
  try {
    globalThis.fetch = async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const tokens: string[] = [];
    for await (const token of streamLisa([{ role: 'user', content: 'Hi' }], new AbortController().signal)) tokens.push(token);
    assert.deepEqual(tokens, ['Hello']);
    const requestBody = sent as Record<string, unknown> | null;
    assert.ok(requestBody);
    assert.equal(requestBody['model'], 'lisa');
    assert.equal(Object.prototype.hasOwnProperty.call(requestBody, 'temperature'), false);
    assert.equal(requestBody['max_tokens'], 120);
    assert.deepEqual(requestBody['stream_options'], { include_usage: true });
  } finally { globalThis.fetch = original; }
});

test('LLM messages are merged so roles alternate for strict chat templates', async () => {
  const { alternateRoles } = await import('./providers');
  assert.deepEqual(alternateRoles([
    { role: 'system', content: 'S' },
    { role: 'user', content: '<context_data>{}</context_data>' },
    { role: 'assistant', content: 'A0' },
    { role: 'user', content: 'U1' },
    { role: 'user', content: 'U2' },
  ]), [
    { role: 'system', content: 'S' },
    { role: 'user', content: '<context_data>{}</context_data>' },
    { role: 'assistant', content: 'A0' },
    { role: 'user', content: 'U1\n\nU2' },
  ]);
  assert.deepEqual(alternateRoles([{ role: 'system', content: 'S' }, { role: 'assistant', content: 'A' }, { role: 'user', content: 'U' }]),
    [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
});

test('OpenAI test mode sends Lisa to OpenAI with max_completion_tokens and leaves VOICE_LLM_* alone', async () => {
  const { streamLisa } = await import('./providers');
  const { config } = await import('../config');
  const original = globalThis.fetch;
  let sentUrl = '';
  let sentAuth = '';
  let sent: Record<string, unknown> = {};
  config.openAiTestApiKey = 'sk-test-only';
  try {
    globalThis.fetch = async (input, init) => {
      sentUrl = String(input);
      sentAuth = String((init?.headers as Record<string, string>)?.Authorization);
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    for await (const token of streamLisa([{ role: 'user', content: 'Hi' }], new AbortController().signal)) void token;
    assert.equal(sentUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(sentAuth, 'Bearer sk-test-only');
    assert.equal(sent['model'], config.openAiTestModel);
    assert.equal(sent['max_completion_tokens'], 120);
    assert.equal(Object.prototype.hasOwnProperty.call(sent, 'max_tokens'), false);
    assert.equal(config.voiceLlmModel, 'lisa');
  } finally { globalThis.fetch = original; config.openAiTestApiKey = ''; }
});

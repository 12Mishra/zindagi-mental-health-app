import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket, { WebSocketServer } from 'ws';

process.env.DATABASE_URL ||= 'postgresql://unused:unused@127.0.0.1:5432/unused';
process.env.SARVAM_API_KEY = 'test-only';

/** Fake Sarvam TTS socket: answers each text+flush with two PCM messages and a `final` event. */
async function fakeSarvam(options: { holdAudio?: boolean } = {}) {
  const server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');
  const received: Array<Record<string, any>> = [];
  const headers: string[] = [];
  server.on('connection', (socket, request) => {
    headers.push(String(request.headers['api-subscription-key']));
    let text = '';
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      received.push(message);
      if (message.type === 'text') text = message.data.text;
      if (message.type !== 'flush' || options.holdAudio) return;
      const pcm = Buffer.from(text.slice(0, 4).padEnd(4, '_'));
      for (const half of [pcm.subarray(0, 2), pcm.subarray(2)]) socket.send(JSON.stringify({
        type: 'audio', data: { content_type: 'audio/pcm', audio: half.toString('base64') } }));
      socket.send(JSON.stringify({ type: 'event', data: { event_type: 'final' } }));
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, received, headers, url: `ws://127.0.0.1:${address.port}/text-to-speech/ws` };
}

test('WS TTS session pipelines clauses on one socket and matches audio in order', async () => {
  const { SarvamWsTtsSession } = await import('./tts-session');
  const fake = await fakeSarvam();
  const tts = new SarvamWsTtsSession(fake.url);
  try {
    await tts.open();
    tts.setVoice({ languageCode: 'hi-IN', speaker: 'shubh' });
    const audio: Record<number, string> = { 0: '', 1: '' };
    const signal = new AbortController().signal;
    await Promise.all([
      tts.speak('AAAA first', 0, pcm => { audio[0] += pcm.toString(); }, signal),
      tts.speak('BBBB second', 1, pcm => { audio[1] += pcm.toString(); }, signal),
    ]);
    assert.deepEqual(audio, { 0: 'AAAA', 1: 'BBBB' });
    assert.equal(fake.headers.length, 1);
    assert.equal(fake.headers[0], 'test-only');
    const configs = fake.received.filter(message => message.type === 'config');
    assert.equal(configs.length, 1);
    assert.equal(configs[0].data.language_code, 'hi-IN');
    assert.equal(configs[0].data.output_audio_codec, 'linear16');
    assert.equal(configs[0].data.speech_sample_rate, '24000');
  } finally {
    tts.close();
    for (const client of fake.server.clients) client.terminate();
    fake.server.close();
  }
});

test('WS TTS cancel resolves pending speech and reconnects for the next clause', async () => {
  const { SarvamWsTtsSession } = await import('./tts-session');
  const fake = await fakeSarvam({ holdAudio: true });
  const tts = new SarvamWsTtsSession(fake.url);
  try {
    await tts.open();
    const controller = new AbortController();
    const speaking = tts.speak('never answered', 0, () => assert.fail('no audio expected'), controller.signal);
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort();
    await speaking;
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(fake.headers.length, 2);
    assert.ok([...fake.server.clients].some(client => client.readyState === WebSocket.OPEN));
  } finally {
    tts.close();
    for (const client of fake.server.clients) client.terminate();
    fake.server.close();
  }
});

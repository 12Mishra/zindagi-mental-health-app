// Synthetic/consented PCM fixture load harness. It does not prove device playback.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

const flag = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const ticketsPath = flag('tickets');
const pcmPath = flag('pcm');
const url = flag('url') ?? 'ws://localhost:4001/voice';
const sessions = Number(flag('sessions') ?? 1);
const staggerMs = Number(flag('stagger-ms') ?? 0);
if (!ticketsPath || !pcmPath || !Number.isSafeInteger(sessions) || sessions < 1 || sessions > 3) {
  throw new Error('Usage: node scripts/load-voice.mjs --tickets tickets.json --pcm synthetic-16k-mono.pcm --sessions 1|2|3 [--url ws://...] [--stagger-ms 0]');
}
const tickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf8'));
if (!Array.isArray(tickets) || tickets.length < sessions || tickets.some(x => typeof x !== 'string')) {
  throw new Error('Ticket file must contain one fresh ticket string per session.');
}
const pcm = fs.readFileSync(pcmPath);
if (pcm.length < 640 || pcm.length > 5_000_000 || pcm.length % 640) {
  throw new Error('PCM fixture must be 16 kHz mono signed 16-bit and a whole number of 20 ms frames (640 bytes each).');
}

async function run(index) {
  if (staggerMs) await new Promise(resolve => setTimeout(resolve, index * staggerMs));
  const socket = new WebSocket(url);
  const result = { session: index + 1, ready: false, speechEndToFirstAudioMs: null, audioChunks: 0, errorCode: null };
  let timer = null;
  let speechEndAt = null;
  let audioStarted = false;
  return new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearInterval(timer);
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 1, type: 'end' }));
      setTimeout(() => { socket.terminate(); resolve(result); }, 300);
    };
    const timeout = setTimeout(finish, 45_000);
    socket.on('open', () => socket.send(JSON.stringify({ v: 1, type: 'hello', ticket: tickets[index],
      format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, frameMs: 20 } })));
    socket.on('message', (payload, binary) => {
      if (binary) { if (audioStarted) result.audioChunks++; return; }
      let event;
      try { event = JSON.parse(payload.toString()); } catch { return; }
      if (event.type === 'ready') {
        result.ready = true;
        let offset = 0;
        timer = setInterval(() => {
          if (offset >= pcm.length) { clearInterval(timer); timer = null; return; }
          if (socket.bufferedAmount > 64 * 1024) { result.errorCode = 'client_backpressure'; finish(); return; }
          socket.send(pcm.subarray(offset, offset + 640)); offset += 640;
        }, 20);
      }
      if (event.type === 'speech_end') speechEndAt = performance.now();
      if (event.type === 'audio_start') {
        audioStarted = true;
        if (speechEndAt !== null && result.speechEndToFirstAudioMs === null) {
          result.speechEndToFirstAudioMs = Math.round(performance.now() - speechEndAt);
        }
      }
      if (event.type === 'error') result.errorCode = event.code;
      if (event.type === 'audio_end' || event.type === 'session_end') { clearTimeout(timeout); finish(); }
    });
    socket.on('error', () => { result.errorCode = 'socket_error'; clearTimeout(timeout); finish(); });
    socket.on('close', () => { if (!finished) { result.errorCode ??= 'socket_closed'; finish(); } });
  });
}

const results = await Promise.all(Array.from({ length: sessions }, (_, index) => run(index)));
console.log(JSON.stringify({
  kind: 'synthetic_or_consented_fixture_transport_only', sessions,
  results, limitations: 'No physical playback, no clinical assessment, no capacity claim from idle sockets.',
}, null, 2));

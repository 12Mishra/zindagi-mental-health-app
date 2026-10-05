import { parentPort } from 'node:worker_threads';

parentPort?.on('message', (audio: ArrayBuffer) => {
  const samples = new Int16Array(audio);
  let sumSquares = 0;
  let crossings = 0;
  let previous = 0;
  for (const sample of samples) {
    const value = sample / 32768;
    sumSquares += value * value;
    if ((value >= 0) !== (previous >= 0)) crossings++;
    previous = value;
  }
  parentPort?.postMessage({
    rms: Math.round(Math.sqrt(sumSquares / Math.max(1, samples.length)) * 1000) / 1000,
    zeroCrossings: crossings,
    durationMs: Math.round(samples.length / 16),
    emotion: 'not_available',
  });
});

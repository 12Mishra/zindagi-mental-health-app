import assert from 'node:assert/strict';
import test from 'node:test';
import { BargeInDetector } from './turn-taking';

test('SpeechStarted alone never interrupts', () => {
  const detector = new BargeInDetector(2);
  detector.arm();
  assert.equal(detector.speechStarted(), false);
});

test('short backchannels during playback do not interrupt', () => {
  const detector = new BargeInDetector(2);
  detector.arm();
  for (const text of ['hmm', 'haan', 'ok', 'accha', 'haan haan', 'ok accha', 'हाँ', 'yeah'])
    assert.equal(detector.partial(text), false, text);
  assert.equal(detector.partial('wait'), false);
});

test('two or more new words interrupt once', () => {
  const detector = new BargeInDetector(2);
  detector.arm();
  assert.equal(detector.partial('wait, actually'), true);
  assert.equal(detector.partial('wait, actually I'), false);
  detector.arm();
  assert.equal(detector.partial('ruko ek minute'), true);
});

test('nothing interrupts while disarmed', () => {
  const detector = new BargeInDetector(2);
  assert.equal(detector.partial('this is a long sentence'), false);
});

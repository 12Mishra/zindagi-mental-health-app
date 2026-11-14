import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { open, seal } from './crypto';
import { buildBrief, moodTrend } from './brief';

test('notes round-trip and ciphertext does not contain the plaintext', () => {
  const key = randomBytes(32);
  const sealed = seal('Student mentioned exam panic before finals', key);
  assert.equal(open(sealed, key), 'Student mentioned exam panic before finals');
  assert.ok(!Buffer.from(sealed.ciphertext, 'base64').toString('utf8').includes('exam'));
});

test('tampered or wrong-key notes fail to decrypt', () => {
  const key = randomBytes(32);
  const sealed = seal('private', key);
  assert.throws(() => open(sealed, randomBytes(32)));
  assert.throws(() => open({ ...sealed, ciphertext: Buffer.from('xxxxxxx').toString('base64') }, key));
});

test('the same note encrypts differently each time (fresh IV)', () => {
  const key = randomBytes(32);
  assert.notEqual(seal('same', key).ciphertext, seal('same', key).ciphertext);
});

test('mood trend needs at least four scores and uses older vs newer halves', () => {
  assert.equal(moodTrend([3, 3, 3]), 'unknown');
  assert.equal(moodTrend([2, 2, 4, 4]), 'improving');
  assert.equal(moodTrend([4, 4, 2, 2]), 'declining');
  assert.equal(moodTrend([3, 3, 3, 3]), 'stable');
});

test('brief carries themes and risk but no identity fields', () => {
  const brief = buildBrief({
    reason: 'ANXIETY', scoresOldestFirst: [4, 4, 2, 2],
    topics: ['ACADEMIC', 'ACADEMIC', 'SLEEP'], risk: ['ELEVATED', 'ELEVATED', 'URGENT'],
  });
  assert.deepEqual(brief.themes, ['Academic pressure', 'Sleep']);
  assert.deepEqual(brief.riskLevels, ['ELEVATED', 'URGENT']);
  assert.equal(brief.moodTrend, 'declining');
  const json = JSON.stringify(brief);
  assert.ok(!/phone|fullName|email/i.test(json));
});

test('brief with no data degrades to unknown instead of failing', () => {
  const brief = buildBrief({ reason: null, scoresOldestFirst: [], topics: [], risk: [] });
  assert.equal(brief.moodTrend, 'unknown');
  assert.deepEqual(brief.riskLevels, ['UNKNOWN']);
  assert.deepEqual(brief.themes, []);
});

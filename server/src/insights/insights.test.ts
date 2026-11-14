import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCheckin } from '../checkins/checkin.service';
import { addDays, mondayOf, todayIn } from './dates';
import { COHORT_PATTERN, heatBucket, signed, suppress } from './privacy';
import { classifySeverity } from './severity';
import { parseTopics } from './topics';

test('suppress hides a value below k, when n is unknown, or when there is no value', () => {
  assert.equal(suppress(5, 10, 10), 5);
  assert.equal(suppress(5, 9, 10), null);
  assert.equal(suppress(5, undefined, 10), null);
  assert.equal(suppress(null, 50, 10), null);
  assert.equal(suppress(0, 10, 10), 0); // zero is a real value, not "missing"
});

test('heatBucket maps mean mood 1-5 to buckets 5..1 and clamps', () => {
  assert.deepEqual([5, 4, 3, 2, 1].map(heatBucket), [1, 2, 3, 4, 5]);
  assert.equal(heatBucket(5.4), 1);
  assert.equal(heatBucket(0.2), 5);
});

test('cohort keys are whitelisted', () => {
  for (const ok of ['all', 'year:1', 'year:4', 'dept:CSE', 'dept:ME2']) assert.ok(COHORT_PATTERN.test(ok), ok);
  for (const bad of ['', 'year:9', 'dept:', 'dept:cse', "all'; DROP TABLE", 'year:1,dept:CSE']) assert.ok(!COHORT_PATTERN.test(bad), bad);
});

test('signed formats deltas', () => {
  assert.equal(signed(3), '+3');
  assert.equal(signed(-2), '-2');
  assert.equal(signed(0.04, 1), '+0.0');
});

test('date helpers work on plain calendar days', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(mondayOf('2026-11-06'), '2026-11-02'); // a Friday
  assert.equal(mondayOf('2026-11-02'), '2026-11-02');
  assert.equal(mondayOf('2026-11-08'), '2026-11-02'); // a Sunday belongs to the week that started Monday
  // 20:00 UTC on the 6th is already the 7th in India
  assert.equal(todayIn('Asia/Kolkata', new Date('2026-11-06T20:00:00Z')), '2026-11-07');
  assert.equal(todayIn('UTC', new Date('2026-11-06T20:00:00Z')), '2026-11-06');
});

test('parseTopics keeps valid, distinct topics, caps at 3 and falls back to OTHER', () => {
  assert.deepEqual(parseTopics(['academic', 'ANXIETY', 'Academic', 'NONSENSE', 7]), ['ACADEMIC', 'ANXIETY']);
  assert.deepEqual(parseTopics(['SLEEP', 'CAREER', 'FAMILY', 'HEALTH']), ['SLEEP', 'CAREER', 'FAMILY']);
  for (const bad of [undefined, null, 'ACADEMIC', [], ['x']]) assert.deepEqual(parseTopics(bad), ['OTHER']);
});

test('parseCheckin validates score, tags and note', () => {
  assert.deepEqual(parseCheckin({ score: 4, tags: [' calm '], note: '  fine  ' }), { score: 4, tags: ['calm'], note: 'fine' });
  assert.deepEqual(parseCheckin({ score: 1 }), { score: 1, tags: [], note: null });
  for (const bad of [{}, { score: 0 }, { score: 6 }, { score: 2.5 }, { score: '3' }, { score: 3, tags: 'x' },
    { score: 3, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, { score: 3, note: 'x'.repeat(501) }]) {
    assert.throws(() => parseCheckin(bad), /must be/, JSON.stringify(bad).slice(0, 40));
  }
});

test('severity: an empty note is LOW and an explicit regex URGENT never needs a model', async () => {
  assert.deepEqual(await classifySeverity('   '), { level: 'LOW', source: 'regex' });
  assert.deepEqual(await classifySeverity('I want to kill myself'), { level: 'URGENT', source: 'regex' });
});

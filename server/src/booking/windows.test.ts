import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, parseStudentDetails, parseWindows, windowProblem } from './windows';

// Monday 1 Dec 2025, 08:00 IST.
const NOW = new Date('2025-12-01T08:00:00+05:30');
const ist = (s: string) => new Date(`${s}+05:30`);

test('office-hours windows are accepted', () => {
  assert.equal(windowProblem(ist('2025-12-01T09:00:00'), NOW), null);
  assert.equal(windowProblem(ist('2025-12-05T16:00:00'), NOW), null); // Friday, last slot of the day
});

test('windows outside office hours, off the hour, at weekends or too far ahead are rejected', () => {
  assert.match(windowProblem(ist('2025-12-01T17:00:00'), NOW)!, /between/);
  assert.match(windowProblem(ist('2025-12-01T08:00:00'), NOW)!, /between|past/);
  assert.match(windowProblem(ist('2025-12-01T10:30:00'), NOW)!, /on the hour/);
  assert.match(windowProblem(ist('2025-12-06T10:00:00'), NOW)!, /weekday/);
  assert.match(windowProblem(ist('2025-12-22T10:00:00'), NOW)!, /within/);
  assert.match(windowProblem(new Date('nope'), NOW)!, /valid/);
});

test('windows in the past are rejected', () => {
  const later = new Date('2025-12-01T12:30:00+05:30');
  assert.match(windowProblem(ist('2025-12-01T12:00:00'), later)!, /past/);
});

test('parseWindows de-duplicates, sorts and caps the list', () => {
  const out = parseWindows(['2025-12-02T05:30:00.000Z', '2025-12-01T04:30:00.000Z', '2025-12-02T05:30:00.000Z'], NOW);
  assert.deepEqual(out.map(d => d.toISOString()), ['2025-12-01T04:30:00.000Z', '2025-12-02T05:30:00.000Z']);
  assert.throws(() => parseWindows([], NOW), /at least one/);
  const many = Array.from({ length: 13 }, (_, i) => ist(`2025-12-0${2 + Math.floor(i / 8)}T${String(9 + (i % 8)).padStart(2, '0')}:00:00`).toISOString());
  assert.throws(() => parseWindows(many, NOW), /at most/);
});

test('overlap is half-open, so back-to-back hours do not clash', () => {
  const nine = ist('2025-12-01T09:00:00');
  assert.equal(overlaps(nine, ist('2025-12-01T10:00:00'), ist('2025-12-01T11:00:00')), false);
  assert.equal(overlaps(nine, ist('2025-12-01T09:30:00'), ist('2025-12-01T10:20:00')), true);
});

test('roll number and branch are normalised and validated', () => {
  assert.deepEqual(parseStudentDetails(' 102103456 ', '  Computer   Engineering '), { rollNumber: '102103456', branch: 'Computer Engineering' });
  assert.equal(parseStudentDetails('ab12c', 'COE').rollNumber, 'AB12C');
  assert.throws(() => parseStudentDetails('', 'COE'), /roll number/);
  assert.throws(() => parseStudentDetails('12 34', 'COE'), /roll number/);
  assert.throws(() => parseStudentDetails('102103456', ''), /branch/);
});

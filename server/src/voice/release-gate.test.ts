import assert from 'node:assert/strict';
import test from 'node:test';
import type { Triage } from './policy';
import { ReleaseGate } from './release-gate';

const setup = (regexLevel: Triage['level'], timeoutMs = 1000) => {
  const released: string[] = [];
  const blocks: Array<{ level: string; late: boolean }> = [];
  const gate = new ReleaseGate<string>({
    regexLevel, timeoutMs,
    release: item => released.push(item),
    block: (triage, late) => blocks.push({ level: triage.level, late }),
  });
  return { gate, released, blocks };
};
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('LOW releases held clauses in order, then future clauses immediately', () => {
  const { gate, released, blocks } = setup('LOW');
  gate.push('a'); gate.push('b');
  assert.deepEqual(released, []);
  gate.settle({ level: 'LOW', action: 'continue' });
  assert.deepEqual(released, ['a', 'b']);
  gate.push('c');
  assert.deepEqual(released, ['a', 'b', 'c']);
  assert.deepEqual(blocks, []);
});

for (const level of ['ELEVATED', 'URGENT', 'UNKNOWN'] as const) {
  test(`${level} discards held clauses and reports the policy route`, () => {
    const { gate, released, blocks } = setup('LOW');
    gate.push('a');
    gate.settle({ level, action: level === 'URGENT' ? 'local_support_prompt' : 'clarify_safety' });
    gate.push('b');
    assert.deepEqual(released, []);
    assert.deepEqual(blocks, [{ level, late: false }]);
  });
}

test('timeout releases only regex-LOW turns', async () => {
  const low = setup('LOW', 10);
  const unknown = setup('UNKNOWN', 10);
  low.gate.push('a'); unknown.gate.push('a');
  await wait(30);
  assert.deepEqual(low.released, ['a']);
  assert.deepEqual(unknown.released, []);
  unknown.gate.close();
});

test('late non-LOW verdict after a timeout release is reported as a late block', async () => {
  const { gate, released, blocks } = setup('LOW', 5);
  gate.push('a');
  await wait(20);
  gate.settle({ level: 'URGENT', action: 'local_support_prompt' });
  gate.push('b');
  assert.deepEqual(released, ['a']);
  assert.deepEqual(blocks, [{ level: 'URGENT', late: true }]);
});

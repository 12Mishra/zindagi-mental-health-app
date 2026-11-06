import assert from 'node:assert/strict';
import test from 'node:test';
import { makePseudonym } from '../insights/pseudonym';
import { hashPassword, verifyPassword } from './password';

test('password hash verifies the right password only and is salted', async () => {
  const hash = await hashPassword('correct horse');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(await verifyPassword('correct horse', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.notEqual(hash, await hashPassword('correct horse'));
});

test('malformed stored hashes never verify', async () => {
  assert.equal(await verifyPassword('x', ''), false);
  assert.equal(await verifyPassword('x', 'plain'), false);
  assert.equal(await verifyPassword('x', `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`), false);
});

test('pseudonym is stable, salted per institution and formatted like #AB123', () => {
  const a = makePseudonym('user-1', 'salt-a');
  assert.match(a, /^#[A-Z]{2}\d{3}$/);
  assert.equal(a, makePseudonym('user-1', 'salt-a'));
  assert.notEqual(makePseudonym('user-1', 'salt-a', 1), a);
  const others = new Set(Array.from({ length: 50 }, (_, i) => makePseudonym(`user-${i}`, 'salt-a')));
  assert.ok(others.size > 40, 'pseudonyms should rarely collide');
});

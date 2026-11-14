import { createHash, createHmac } from 'node:crypto';
import { open, seal } from '../booking/crypto';

/**
 * Field-level encryption for trusted contacts. Reuses the AES-256-GCM helper from booking/crypto.ts, but with its own
 * key (CONTACTS_ENCRYPTION_KEY, 64 hex chars) so a leaked notes key does not expose contacts.
 */
function loadKey(): Buffer {
  const raw = process.env.CONTACTS_ENCRYPTION_KEY ?? '';
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (process.env.NODE_ENV === 'production') throw new Error('CONTACTS_ENCRYPTION_KEY must be 64 hex characters in production.');
  return createHash('sha256').update('zindagi-dev-contacts-key').digest();
}

/** Stored as one string: iv.tag.ciphertext (all base64). */
export function sealField(plaintext: string, key: Buffer = loadKey()): string {
  const sealed = seal(plaintext, key);
  return `${sealed.iv}.${sealed.tag}.${sealed.ciphertext}`;
}

export function openField(stored: string, key: Buffer = loadKey()): string {
  const [iv, tag, ciphertext] = stored.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('contact_field_corrupt');
  return open({ iv, tag, ciphertext }, key);
}

/** Deterministic keyed hash of an E.164 number: duplicate checks without decrypting. Scoped per student by the unique index. */
export function phoneHash(e164: string, key: Buffer = loadKey()): string {
  return createHmac('sha256', key).update(`phone:${e164}`).digest('hex');
}

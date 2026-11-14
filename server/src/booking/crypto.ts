import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM for therapist notes. The key is 32 bytes given as 64 hex chars in NOTES_ENCRYPTION_KEY. */
export type Sealed = { ciphertext: string; iv: string; tag: string };

function loadKey(): Buffer {
  const raw = process.env.NOTES_ENCRYPTION_KEY ?? '';
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (process.env.NODE_ENV === 'production') throw new Error('NOTES_ENCRYPTION_KEY must be 64 hex characters in production.');
  // Dev convenience only: a fixed derived key so local notes work without setup.
  return createHash('sha256').update('zindagi-dev-notes-key').digest();
}

export function seal(plaintext: string, key: Buffer = loadKey()): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function open(sealed: Sealed, key: Buffer = loadKey()): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

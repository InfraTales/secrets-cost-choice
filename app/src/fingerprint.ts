import { createHash } from 'node:crypto';

/**
 * The readers never return or log a secret. They return the first 12 hex characters of
 * its SHA-256 instead, which is enough to tell two values apart and useless to an attacker
 * for a random value of 32 bytes.
 */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

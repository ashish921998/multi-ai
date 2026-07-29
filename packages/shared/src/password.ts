/**
 * Password and one-time-code hashing.
 *
 * Uses PBKDF2-HMAC-SHA256 via the runtime WebCrypto so the same code runs in
 * Node 20+, Deno, and browsers. We deliberately do not pull in argon2: it is
 * not available in the WebCrypto surface that every target runtime shares.
 *
 * Only hashes are ever persisted. Plaintext passwords and connection codes
 * exist only in memory long enough to be transmitted and hashed.
 */

import { KEY_BYTES, PBKDF2_ITERATIONS, SALT_BYTES } from "./config.ts";
import { allocBytes, fromBase64, toBase64 } from "./encoding.ts";
import { randomBytes } from "./ids.ts";

export interface PasswordHash {
  /** Base64 of the derived key bytes. */
  hash: string;
  /** Base64 of the random salt. */
  salt: string;
  iterations: number;
}

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto SubtleCrypto is unavailable in this runtime");
  return s;
};

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const keyMaterial = await subtle().importKey(
    "raw",
    encodeUtf8(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Hashes a room password, returning a record safe to persist. */
export async function hashRoomPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  return { hash: toBase64(hash), salt: toBase64(salt), iterations: PBKDF2_ITERATIONS };
}

/** Verifies a candidate password against a stored hash record. */
export async function verifyRoomPassword(
  password: string,
  stored: PasswordHash,
): Promise<boolean> {
  const derived = await deriveKey(password, fromBase64(stored.salt), stored.iterations);
  return constantTimeEqual(derived, fromBase64(stored.hash));
}

/** Hashes a one-time connection code, returning a record safe to persist. */
export async function hashConnectionCode(code: string): Promise<PasswordHash> {
  return hashRoomPassword(code);
}

/** Verifies a candidate one-time connection code against a stored hash record. */
export async function verifyConnectionCode(
  code: string,
  stored: PasswordHash,
): Promise<boolean> {
  return verifyRoomPassword(code, stored);
}

function encodeUtf8(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const out = allocBytes(encoded.byteLength);
  out.set(encoded);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
/**
 * Random identifier and secret generation.
 *
 * Every random value uses the runtime WebCrypto CSPRNG so the same code runs
 * in the browser, in the local Pi connector (Node 20+), and in Deno Edge
 * Functions. All codes use an *unambiguous* alphabet (no 0/O/1/I) so they can
 * be read aloud or typed from a screenshot without ambiguity.
 */

import {
  CONNECTION_CODE_LENGTH,
  PASSWORD_SYMBOLS,
  ROOM_ID_LENGTH,
} from "./config.ts";
import { toBase64, allocBytes } from "./encoding.ts";

/**
 * 32-symbol unambiguous alphabet: 23 letters + 9 digits, with 0, O, 1, and I
 * removed. Every generated id, password, and connection code is drawn from it.
 */
export const UNAMBIGUOUS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" as const;

function cryptoGlobal(): Crypto {
  const c = globalThis.crypto;
  if (!c) throw new Error("WebCrypto is unavailable in this runtime");
  return c;
}
/** Returns `count` cryptographically random bytes. */
export function randomBytes(count: number): Uint8Array<ArrayBuffer> {
  const out = allocBytes(count);
  cryptoGlobal().getRandomValues(out);
  return out;
}

/** Draws `length` symbols from `alphabet`. */
function sample(alphabet: string, length: number): string {
  const max = alphabet.length;
  // Reject-modulo to avoid modulo bias.
  const limit = Math.floor(256 / max) * max;
  const bytes = randomBytes(length * 2);
  let out = "";
  let picked = 0;
  let cursor = 0;
  while (picked < length) {
    const byte = bytes[cursor++] ?? 0;
    if (cursor >= bytes.length) {
      // Extremely unlikely; replenish if we somehow run out.
      bytes.set(randomBytes(bytes.length), 0);
      cursor = 0;
    }
    if (byte >= limit) continue;
    out += alphabet[byte % max];
    picked++;
  }
  return out;
}

/** Random, url-safe, unambiguous room id, e.g. `K7Q9FXM2PW`. */
export function generateRoomId(): string {
  return sample(UNAMBIGUOUS_ALPHABET, ROOM_ID_LENGTH);
}

/**
 * Random human-shareable room password. Sixteen unambiguous symbols grouped
 * as `XXXX-XXXX-XXXX-XXXX` so it is easy to read aloud or paste into a call.
 */
export function generateRoomPassword(): string {
  const symbols = sample(UNAMBIGUOUS_ALPHABET, PASSWORD_SYMBOLS);
  return symbols.match(/.{1,4}/g)!.join("-");
}

/**
 * One-time connection code for `/room connect <code>`, eight unambiguous
 * symbols grouped as `XXXX-XXXX`.
 */
export function generateConnectionCode(): string {
  const symbols = sample(UNAMBIGUOUS_ALPHABET, CONNECTION_CODE_LENGTH);
  return `${symbols.slice(0, 4)}-${symbols.slice(4)}`;
}

/** Opaque participant id, used as the browser session identity. */
export function generateParticipantId(): string {
  const bytes = randomBytes(12);
  return toBase64Url(bytes);
}

/** Opaque id for rooms, messages, handoffs, connections, and screenshots. */
export function generateId(prefix: string): string {
  const bytes = randomBytes(9);
  return `${prefix}_${toBase64Url(bytes)}`;
}

/**
 * Normalizes user-typed connection code input: uppercase, drop whitespace and
 * dashes, drop any symbol outside the unambiguous alphabet, then trim to the
 * configured length. Ambiguous symbols (0/O/1/I) are dropped because they can
 * never be part of a real code.
 */
export function normalizeConnectionCode(input: string): string {
  const allowed = new Set<string>(UNAMBIGUOUS_ALPHABET);
  let out = "";
  for (const ch of input.toUpperCase()) {
    if (ch === " " || ch === "-") continue;
    if (!allowed.has(ch)) continue;
    if (out.length >= CONNECTION_CODE_LENGTH) break;
    out += ch;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

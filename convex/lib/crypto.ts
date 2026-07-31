/**
 * Runtime-portable crypto helpers.
 *
 * Convex runs in a V8 isolate that exposes the WebCrypto surface, so the same
 * `crypto.subtle` / `crypto.getRandomValues` calls used by @multi-ai/shared
 * work here unchanged. We only need SHA-256 (for session-token hashes and
 * rate-limit keys) and a hex random generator (for session-token entropy).
 */

/** SHA-256 hex digest of a UTF-8 string. */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `bytes` cryptographically random bytes as a lowercase hex string. */
export function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

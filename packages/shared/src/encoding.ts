/**
 * Runtime-portable base64 helpers.
 *
 * These run unchanged in the browser, in Node 16+, and in Deno. We avoid
 * `Buffer` on purpose: it is a Node global and is not part of the WebCrypto
 * surface the other runtimes share. `btoa`/`atob` and `TextEncoder` are.
 */

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = allocBytes(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Allocates a fresh `ArrayBuffer`-backed byte array. */
export function allocBytes(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length));
}

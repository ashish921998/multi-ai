import { describe, it, expect } from "vitest";
import {
  hashRoomPassword,
  verifyRoomPassword,
  hashConnectionCode,
  verifyConnectionCode,
} from "../src/password.ts";

describe("hashRoomPassword / verifyRoomPassword", () => {
  it("verifies the password that was hashed", async () => {
    const stored = await hashRoomPassword("correct-horse-battery");
    expect(await verifyRoomPassword("correct-horse-battery", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashRoomPassword("correct-horse-battery");
    expect(await verifyRoomPassword("wrong-password", stored)).toBe(false);
  });

  it("produces a different hash for different salts", async () => {
    const a = await hashRoomPassword("same-password");
    const b = await hashRoomPassword("same-password");
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it("is deterministic for the same salt and iteration count", async () => {
    const first = await hashRoomPassword("same-password");
    const second = {
      hash: first.hash,
      salt: first.salt,
      iterations: first.iterations,
    };
    expect(await verifyRoomPassword("same-password", second)).toBe(true);
  });

  it("never stores the plaintext password in the record", async () => {
    const stored = await hashRoomPassword("plaintext-secret");
    expect(JSON.stringify(stored)).not.toContain("plaintext-secret");
  });
});

describe("hashConnectionCode / verifyConnectionCode", () => {
  it("verifies a one-time code that was hashed", async () => {
    const stored = await hashConnectionCode("ABCD1234");
    expect(await verifyConnectionCode("ABCD1234", stored)).toBe(true);
  });

  it("rejects a wrong code", async () => {
    const stored = await hashConnectionCode("ABCD1234");
    expect(await verifyConnectionCode("WRONG123", stored)).toBe(false);
  });

  it("never stores the plaintext code in the record", async () => {
    const stored = await hashConnectionCode("ABCD1234");
    expect(JSON.stringify(stored)).not.toContain("ABCD1234");
  });
});

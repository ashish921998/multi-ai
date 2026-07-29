import { describe, it, expect } from "vitest";
import {
  generateRoomId,
  generateRoomPassword,
  generateConnectionCode,
  generateParticipantId,
  normalizeConnectionCode,
  UNAMBIGUOUS_ALPHABET,
} from "../src/ids.ts";

describe("generateRoomId", () => {
  it("produces a url-safe unambiguous id of the configured length", () => {
    const id = generateRoomId();
    expect(id).toHaveLength(10);
    for (const ch of id) {
      expect(UNAMBIGUOUS_ALPHABET).toContain(ch);
    }
  });

  it("is extremely unlikely to collide across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50_000; i++) seen.add(generateRoomId());
    // 10 chars from a 32-symbol alphabet => ~50k unique draws should not collide.
    expect(seen.size).toBe(50_000);
  });
});

describe("generateRoomPassword", () => {
  it("produces a human-shareable password using only unambiguous symbols", () => {
    const pw = generateRoomPassword();
    for (const ch of pw) {
      expect(UNAMBIGUOUS_ALPHABET.includes(ch) || ch === "-").toBe(true);
    }
    // Should be reasonably long for brute-force resistance.
    expect(pw.replace(/-/g, "").length).toBeGreaterThanOrEqual(16);
  });

  it("varies between calls", () => {
    expect(generateRoomPassword()).not.toBe(generateRoomPassword());
  });
});

describe("generateConnectionCode", () => {
  it("produces a short one-time code a participant can type", () => {
    const code = generateConnectionCode();
    // Strips the dash for length checks; raw code is 8 symbols in two groups.
    expect(code.replace("-", "").length).toBe(8);
    for (const ch of code.replace("-", "")) {
      expect(UNAMBIGUOUS_ALPHABET).toContain(ch);
    }
  });

  it("varies between calls", () => {
    expect(generateConnectionCode()).not.toBe(generateConnectionCode());
  });
});

describe("normalizeConnectionCode", () => {
  it("uppercases and drops spaces and dashes", () => {
    expect(normalizeConnectionCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeConnectionCode("  a b c d 2 3 4 5 ")).toBe("ABCD2345");
  });

  it("drops symbols outside the unambiguous alphabet (0/O/1/I are excluded)", () => {
    expect(normalizeConnectionCode("O0I1")).toBe("");
    expect(normalizeConnectionCode("AB1CD")).toBe("ABCD");
  });

  it("trims to the configured code length", () => {
    expect(normalizeConnectionCode("ABCDEFGH2345")).toBe("ABCDEFGH");
  });
});

describe("generateParticipantId", () => {
  it("produces a distinct opaque id", () => {
    const a = generateParticipantId();
    const b = generateParticipantId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});

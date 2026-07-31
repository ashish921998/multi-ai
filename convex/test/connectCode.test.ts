/**
 * Regression test for the connection-code issue→connect round-trip.
 *
 * Bug: `connectCode.issue` hashed the dashed form (`RMDN-CEA8`) while
 * `agent.connect` verified the normalized form (`RMDNCEA8`), so the connector
 * could never redeem a code. The fix is to hash the normalized form on issue.
 *
 * This tests the shared-library composition (no backend needed): the hash
 * produced by the issue path must verify against the code the connector types.
 */

import { describe, it, expect } from "vitest";
import {
  generateConnectionCode,
  normalizeConnectionCode,
  hashConnectionCode,
  verifyConnectionCode,
} from "@multi-ai/shared";

describe("connection code round-trip", () => {
  it("a code verifies when hashed in the same (normalized) form the connector types", async () => {
    const rawCode = generateConnectionCode(); // e.g. "RMDN-CEA8" (dashed)

    // Issue side (post-fix): hash the NORMALIZED form.
    const stored = await hashConnectionCode(normalizeConnectionCode(rawCode));

    // Connect side: the connector receives the dashed code, normalizes, verifies.
    const typed = normalizeConnectionCode(rawCode);
    expect(await verifyConnectionCode(typed, stored)).toBe(true);
  });

  it("demonstrates the pre-fix bug: hashing the dashed form does NOT verify", async () => {
    const rawCode = generateConnectionCode();

    // Issue side (pre-fix bug): hash the RAW dashed form.
    const buggyStored = await hashConnectionCode(rawCode);

    // Connect side normalizes, so it fails against the dashed-form hash.
    const typed = normalizeConnectionCode(rawCode);
    expect(await verifyConnectionCode(typed, buggyStored)).toBe(false);
  });

  it("normalization is canonical — varied user typings all verify", async () => {
    const rawCode = generateConnectionCode();
    const stored = await hashConnectionCode(normalizeConnectionCode(rawCode));

    const variants = [
      rawCode, // "RMDN-CEA8"
      rawCode.toLowerCase(),
      rawCode.replace("-", " "), // "RMDN CEA8"
      normalizeConnectionCode(rawCode), // "RMDNCEA8"
    ];
    for (const v of variants) {
      expect(await verifyConnectionCode(normalizeConnectionCode(v), stored)).toBe(true);
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  DEFAULT_LEASE_CONFIG,
  DEFAULT_SCREENSHOT_LIMITS,
  DEFAULT_RATE_LIMITS,
  ROOM_INACTIVITY_TTL_MS,
} from "../src/config.ts";

describe("spec-mandated defaults (issues 0005, 0006, 0007)", () => {
  it("expires an agent lease after 30 seconds without a heartbeat", () => {
    expect(DEFAULT_LEASE_CONFIG.heartbeatTimeoutMs).toBe(30_000);
  });

  it("accepts screenshots up to 5 MB", () => {
    expect(DEFAULT_SCREENSHOT_LIMITS.maxBytes).toBe(5 * 1024 * 1024);
  });

  it("allows at most 10 screenshots per handoff", () => {
    expect(DEFAULT_SCREENSHOT_LIMITS.maxPerHandoff).toBe(10);
  });

  it("accepts png, jpeg, and webp", () => {
    expect([...DEFAULT_SCREENSHOT_LIMITS.acceptedMimes].sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it("caps rooms at 10 participants", () => {
    expect(DEFAULT_RATE_LIMITS.participantsPerRoom).toBe(10);
  });

  it("allows 5 failed password attempts per IP per minute", () => {
    expect(DEFAULT_RATE_LIMITS.failedPasswordPerIpPerMinute).toBe(5);
  });

  it("allows 30 messages per participant per minute", () => {
    expect(DEFAULT_RATE_LIMITS.messagesPerParticipantPerMinute).toBe(30);
  });

  it("rate-limits room creation per IP", () => {
    expect(DEFAULT_RATE_LIMITS.roomCreationPerIpPerMinute).toBeGreaterThan(0);
  });

  it("deletes room data after 30 days of inactivity", () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(ROOM_INACTIVITY_TTL_MS).toBe(thirtyDaysMs);
  });
});

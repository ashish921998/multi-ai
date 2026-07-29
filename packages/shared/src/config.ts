import type { LeaseConfig, RateLimits, ScreenshotLimits } from "./types.ts";

/** Default lease rules (issue 0006: 30s heartbeat timeout). */
export const DEFAULT_LEASE_CONFIG: LeaseConfig = {
  heartbeatTimeoutMs: 30_000,
};

/** How often the active connector should send a heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** Default screenshot limits (issue 0005). */
export const DEFAULT_SCREENSHOT_LIMITS: ScreenshotLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxPerHandoff: 10,
  acceptedMimes: ["image/png", "image/jpeg", "image/webp"] as const,
};

/** Default abuse limits (issue 0007). */
export const DEFAULT_RATE_LIMITS: RateLimits = {
  participantsPerRoom: 10,
  failedPasswordPerIpPerMinute: 5,
  messagesPerParticipantPerMinute: 30,
  roomCreationPerIpPerMinute: 5,
};

/** One minute, used as the rate-limit window. */
export const RATE_WINDOW_MS = 60_000;

/** Rooms and their data are deleted after 30 days of inactivity (issue 0004). */
export const ROOM_INACTIVITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** PBKDF2 iteration count for password and connection-code hashing. */
export const PBKDF2_ITERATIONS = 150_000;
/** Salt length in bytes. */
export const SALT_BYTES = 16;
/** Derived key length in bytes. */
export const KEY_BYTES = 32;

/** Code generation sizes. */
export const ROOM_ID_LENGTH = 10;
export const CONNECTION_CODE_LENGTH = 8;
export const PASSWORD_SYMBOLS = 16;

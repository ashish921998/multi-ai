/**
 * Active-agent lease state machine (issues 0002 and 0006).
 *
 * The first connected agent receives an active lease and sends regular heartbeats.
 * Explicit disconnect releases it immediately; missing heartbeats for 30s marks
 * it offline. A second agent cannot forcibly take over a healthy connection, but
 * any participant may connect after the lease ends, and the same connection id
 * may reconnect.
 *
 * These are pure functions over the persisted connection record and the current
 * time, so they can be unit-tested deterministically and reused by the Edge
 * Functions that enforce the lease.
 */

import { DEFAULT_LEASE_CONFIG } from "./config.ts";
import type {
  AcquireLeaseDecision,
  AgentConnection,
  AgentConnectionStatus,
  LeaseConfig,
  LeaseEvaluation,
} from "./types.ts";

export { DEFAULT_LEASE_CONFIG };

/**
 * Evaluates the health of a single connection at `now`. Returns the computed
 * status the caller should persist (or null when the stored status is already
 * correct) and whether the connection currently holds a healthy lease.
 */
export function evaluateLease(
  connection: AgentConnection,
  now: number,
  config: LeaseConfig = DEFAULT_LEASE_CONFIG,
): LeaseEvaluation {
  const ageMs = now - connection.lastHeartbeatAt;
  const timedOut = ageMs > config.heartbeatTimeoutMs;

  if (connection.status === "disconnected") {
    return { isActive: false, nextStatus: null, ageMs };
  }

  if (timedOut) {
    const nextStatus: AgentConnectionStatus = "disconnected";
    return { isActive: false, nextStatus, ageMs };
  }

  return { isActive: true, nextStatus: null, ageMs };
}

/**
 * Decides whether a new connection may acquire the room's active slot.
 *
 * @param holder    the connection that currently holds the slot, or null when
 *                  the slot is empty.
 * @param now       current epoch ms.
 * @param config    lease configuration.
 * @param requestor the connection id attempting to acquire the slot. When the
 *                  requestor is the current holder, re-acquisition is always
 *                  allowed (reconnect).
 */
export function canAcquireActiveSlot(
  holder: AgentConnection | null,
  now: number,
  config: LeaseConfig = DEFAULT_LEASE_CONFIG,
  requestor?: string,
): AcquireLeaseDecision {
  if (holder === null) {
    return { allowed: true, reason: "slot-free" };
  }
  if (requestor !== undefined && holder.id === requestor) {
    return { allowed: true, reason: "same-connection" };
  }
  const health = evaluateLease(holder, now, config);
  if (health.isActive) {
    return { allowed: false, reason: "slot-held-by-other" };
  }
  return { allowed: true, reason: "slot-free" };
}

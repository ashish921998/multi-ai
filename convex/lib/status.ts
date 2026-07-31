/**
 * The single source of truth for "is a handoff in an active (blocking) status".
 *
 * A handoff in `pending`, `delivered`, or `responding` blocks the next "Send to
 * agent". Both the backend (the one-in-flight check, the room snapshot) and the
 * derived `handoffInProgress` flag the browser reads come from here, so the set
 * cannot drift across the boundary.
 */

import type { HandoffStatus } from "@multi-ai/shared";

export const ACTIVE_HANDOFF_STATUSES: ReadonlySet<HandoffStatus> = new Set([
  "pending",
  "delivered",
  "responding",
]);

export function isActiveHandoff(status: string): boolean {
  return ACTIVE_HANDOFF_STATUSES.has(status as HandoffStatus);
}

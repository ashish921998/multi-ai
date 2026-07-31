/**
 * Convex client for the browser app.
 *
 * The whole room is a reactive Convex query: one `useQuery(api.rooms.state)`
 * subscription drives every panel, replacing the old opaque-ticker +
 * fetch-on-tick realtime dance (issue 0004). `VITE_CONVEX_URL` is the deployed
 * (or local) Convex deployment URL.
 */

import { ConvexReactClient } from "convex/react";

const url = import.meta.env.VITE_CONVEX_URL ?? "";

if (!url) {
  // eslint-disable-next-line no-console
  console.warn("VITE_CONVEX_URL is not set; the room will not connect.");
}

export const convex = new ConvexReactClient(url, { unsavedChangesWarning: false });

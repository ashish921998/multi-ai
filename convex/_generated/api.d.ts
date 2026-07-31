/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as api_ from "../api.js";
import type * as cleanup from "../cleanup.js";
import type * as connectCode from "../connectCode.js";
import type * as crons from "../crons.js";
import type * as handoff from "../handoff.js";
import type * as lib_agent from "../lib/agent.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_handoff from "../lib/handoff.js";
import type * as lib_messages from "../lib/messages.js";
import type * as lib_ratelimit from "../lib/ratelimit.js";
import type * as lib_room from "../lib/room.js";
import type * as lib_seq from "../lib/seq.js";
import type * as lib_session from "../lib/session.js";
import type * as lib_status from "../lib/status.js";
import type * as messages from "../messages.js";
import type * as rooms from "../rooms.js";
import type * as screenshots from "../screenshots.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  api: typeof api_;
  cleanup: typeof cleanup;
  connectCode: typeof connectCode;
  crons: typeof crons;
  handoff: typeof handoff;
  "lib/agent": typeof lib_agent;
  "lib/crypto": typeof lib_crypto;
  "lib/errors": typeof lib_errors;
  "lib/handoff": typeof lib_handoff;
  "lib/messages": typeof lib_messages;
  "lib/ratelimit": typeof lib_ratelimit;
  "lib/room": typeof lib_room;
  "lib/seq": typeof lib_seq;
  "lib/session": typeof lib_session;
  "lib/status": typeof lib_status;
  messages: typeof messages;
  rooms: typeof rooms;
  screenshots: typeof screenshots;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

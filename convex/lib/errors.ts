import { ConvexError } from "convex/values";

/**
 * A user-facing error. Convex surfaces `ConvexError` data to the client; the
 * web/connector apps read `.message`. Use these for expected failures (wrong
 * password, room full, one-in-flight handoff). Throw a plain `Error` only for
 * unexpected 500-class failures.
 */
export function fail(message: string): never {
  throw new ConvexError({ message });
}

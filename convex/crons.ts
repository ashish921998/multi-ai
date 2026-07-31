/**
 * Scheduled jobs (replaces the `pg_cron` hourly cleanup from migration 0003).
 *
 * Runs `cleanup:deleteExpired` hourly at :03 UTC — the same schedule the old
 * `cron.schedule('cleanup-expired-rooms', '3 * * * *', …)` used.
 *
 * `deleteExpired` is an internal mutation, so we reference it by name via
 * `makeFunctionReference` (the scheduler resolves the name at runtime and may
 * invoke internal functions). The generated `internal` api tree would work too,
 * but we avoid depending on `convex/_generated/api` before `npx convex dev` runs.
 */

import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();

crons.cron(
  "cleanup-expired-rooms",
  "3 * * * *", // hourly at :03
  makeFunctionReference<"mutation", {}, { deleted: number }>("cleanup:deleteExpired"),
);

export default crons;

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

it("prints the connector CLI help without requiring backend configuration", async () => {
  const { stdout, stderr } = await execFileAsync(tsx, [cli, "--help"], {
    env: { ...process.env, CONVEX_URL: "" },
  });

  expect(stdout).toContain("room connect <roomId> <connectionCode> --agent <name>");
  expect(stdout).toContain("pi, codex, claude, cursor, opencode");
  expect(stderr).toBe("");
});

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BUILT_IN_AGENT_HARNESSES } from "@multi-ai/shared";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

it("prints the connector CLI help without requiring backend configuration", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [tsxCli, cli, "--help"], {
    env: { ...process.env, CONVEX_URL: "" },
  });

  expect(stdout).toContain("room connect <roomId> <connectionCode> --agent <name>");
  expect(stdout).toContain(
    BUILT_IN_AGENT_HARNESSES.map((harness) => harness.id).join(", "),
  );
  expect(stderr).toBe("");
});

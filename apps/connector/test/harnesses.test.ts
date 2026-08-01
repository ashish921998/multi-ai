import { describe, expect, it } from "vitest";
import type { HarnessName } from "@multi-ai/shared";
import { customHarness, getHarness } from "../src/harnesses.ts";

const BUILT_IN_CASES = [
  {
    id: "pi",
    name: "Pi",
    executable: "pi",
    args: ["--print", "--no-session"],
  },
  {
    id: "codex",
    name: "Codex",
    executable: "codex",
    args: ["exec", "--ephemeral", "--sandbox", "read-only", "--color", "never", "-"],
  },
  {
    id: "claude",
    name: "Claude Code",
    executable: "claude",
    args: [
      "--print",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "--output-format",
      "text",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    executable: "cursor-agent",
    args: ["--print", "--sandbox", "enabled", "--output-format", "text"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    executable: "opencode",
    args: ["run", "--format", "default"],
  },
] satisfies ReadonlyArray<{
  id: HarnessName;
  name: string;
  executable: string;
  args: readonly string[];
}>;

describe("built-in agent harnesses", () => {
  it.each(BUILT_IN_CASES)("defines the exact $id process configuration", (expected) => {
    expect(getHarness(expected.id)).toEqual({
      name: expected.name,
      executable: expected.executable,
      args: expected.args,
    });
  });

  it("rejects an unknown harness with the supported names", () => {
    expect(() => getHarness("unknown")).toThrow("pi, codex, claude, cursor, opencode, custom");
  });
});

describe("custom agent harness", () => {
  it("keeps fixed arguments separate from the executable", () => {
    expect(customHarness("my-agent", ["run", "--plain"])).toEqual({
      name: "my-agent",
      executable: "my-agent",
      args: ["run", "--plain"],
    });
  });

  it("normalizes surrounding executable whitespace", () => {
    expect(customHarness("  my-agent  ")).toMatchObject({
      name: "my-agent",
      executable: "my-agent",
    });
  });

  it("requires an executable", () => {
    expect(() => customHarness("  ")).toThrow("requires --command");
  });
});

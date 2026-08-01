import { describe, expect, it } from "vitest";
import { customHarness, getHarness, HARNESS_NAMES } from "../src/harnesses.ts";

const PROMPT = "Review this room handoff; $(this is data, not shell syntax).";

describe("built-in agent harnesses", () => {
  it.each(HARNESS_NAMES)("builds a safe %s invocation containing the prompt once", (name) => {
    const invocation = getHarness(name).invoke(PROMPT);
    const promptCopies = [invocation.stdin, ...invocation.args]
      .filter((value) => value === PROMPT);

    expect(invocation.executable).not.toContain(" ");
    expect(promptCopies).toHaveLength(1);
  });

  it("uses stdin for harnesses with native piped-prompt support", () => {
    expect(getHarness("codex").invoke(PROMPT)).toMatchObject({
      executable: "codex",
      args: ["exec", "--ephemeral", "--sandbox", "read-only", "--color", "never", "-"],
      stdin: PROMPT,
    });
    expect(getHarness("claude").invoke(PROMPT)).toMatchObject({
      executable: "claude",
      args: [
        "--print",
        "--no-session-persistence",
        "--permission-mode",
        "plan",
        "--output-format",
        "text",
      ],
      stdin: PROMPT,
    });
  });

  it("rejects an unknown harness with the supported names", () => {
    expect(() => getHarness("unknown")).toThrow("pi, codex, claude, cursor, opencode, custom");
  });
});

describe("custom agent harness", () => {
  it("passes fixed arguments separately and the room prompt on stdin", () => {
    expect(customHarness("my-agent", ["run", "--plain"]).invoke(PROMPT)).toEqual({
      executable: "my-agent",
      args: ["run", "--plain"],
      stdin: PROMPT,
    });
  });

  it("requires an executable", () => {
    expect(() => customHarness("  ")).toThrow("requires --command");
  });
});

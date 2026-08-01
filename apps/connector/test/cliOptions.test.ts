import { describe, expect, it } from "vitest";
import { parseCliCommand } from "../src/cliOptions.ts";

describe("parseCliCommand", () => {
  it("parses a built-in connect command into a typed selection", () => {
    expect(
      parseCliCommand(
        ["connect", "room123", "ABCD-2345", "--agent", "codex", "--supports-vision"],
        {},
      ),
    ).toEqual({
      kind: "connect",
      roomId: "ROOM123",
      connectionCode: "ABCD-2345",
      agent: { kind: "builtIn", name: "codex" },
      supportsVision: true,
    });
  });

  it("parses a custom executable and keeps each fixed argument separate", () => {
    expect(
      parseCliCommand(
        [
          "connect",
          "ROOM123",
          "ABCD-2345",
          "--agent",
          "custom",
          "--command",
          "my-agent",
          "--arg",
          "run",
          "--arg=--plain",
        ],
        {},
      ),
    ).toMatchObject({
      agent: { kind: "custom", executable: "my-agent", args: ["run", "--plain"] },
    });
  });

  it("preserves the environment-based custom harness compatibility path", () => {
    expect(
      parseCliCommand(["connect", "ROOM123", "ABCD-2345"], {
        ROOM_AGENT_COMMAND: "my-agent",
        ROOM_AGENT_ARGS: '["run","--plain"]',
      }),
    ).toMatchObject({
      agent: { kind: "custom", executable: "my-agent", args: ["run", "--plain"] },
    });
  });

  it("rejects custom-only options for a built-in harness", () => {
    expect(() =>
      parseCliCommand(
        ["connect", "ROOM123", "ABCD-2345", "--agent", "codex", "--command", "other"],
        {},
      ),
    ).toThrow("can only be used with --agent custom");
  });
});

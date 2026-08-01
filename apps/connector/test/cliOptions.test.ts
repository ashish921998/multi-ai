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
          "  my-agent  ",
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

  it("explains how to migrate shell-style environment commands", () => {
    expect(() =>
      parseCliCommand(["connect", "ROOM123", "ABCD-2345"], {
        ROOM_AGENT_COMMAND: "my-agent --plain",
      }),
    ).toThrow(
      "ROOM_AGENT_COMMAND must contain only the executable. Put arguments in ROOM_AGENT_ARGS as a JSON array of strings.",
    );
  });

  it("does not apply environment arguments to an explicit command", () => {
    expect(
      parseCliCommand(
        [
          "connect",
          "ROOM123",
          "ABCD-2345",
          "--agent",
          "custom",
          "--command",
          "one-off-agent",
        ],
        { ROOM_AGENT_ARGS: '["for-a-different-agent"]' },
      ),
    ).toMatchObject({
      agent: { kind: "custom", executable: "one-off-agent", args: [] },
    });
  });

  it("reports malformed ROOM_AGENT_ARGS as an actionable configuration error", () => {
    expect(() =>
      parseCliCommand(["connect", "ROOM123", "ABCD-2345"], {
        ROOM_AGENT_COMMAND: "my-agent",
        ROOM_AGENT_ARGS: "not-json",
      }),
    ).toThrow("ROOM_AGENT_ARGS must be a JSON array of strings.");
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

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
  parseCliCommand,
} from "../src/cliOptions.ts";

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
      shutdownDrainTimeoutMs: DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
    });
  });

  it("parses an explicit shutdown drain limit", () => {
    expect(
      parseCliCommand(
        [
          "connect",
          "ROOM123",
          "ABCD-2345",
          "--agent",
          "codex",
          "--shutdown-drain-timeout-ms=1250",
        ],
        {},
      ),
    ).toMatchObject({ shutdownDrainTimeoutMs: 1250 });
  });

  it("reads the shutdown drain limit from the environment", () => {
    expect(
      parseCliCommand(["connect", "ROOM123", "ABCD-2345", "--agent", "codex"], {
        ROOM_AGENT_SHUTDOWN_DRAIN_TIMEOUT_MS: "2500",
      }),
    ).toMatchObject({ shutdownDrainTimeoutMs: 2500 });
  });

  it("rejects an invalid shutdown drain limit", () => {
    expect(() =>
      parseCliCommand(
        [
          "connect",
          "ROOM123",
          "ABCD-2345",
          "--agent",
          "codex",
          "--shutdown-drain-timeout-ms=-1",
        ],
        {},
      ),
    ).toThrow("Shutdown drain timeout must be a non-negative integer");
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

  it("preserves spaces in an environment-provided executable path", () => {
    expect(
      parseCliCommand(["connect", "ROOM123", "ABCD-2345"], {
        ROOM_AGENT_COMMAND: "/Users/example/My Agent/bin/agent",
        ROOM_AGENT_ARGS: '["--plain"]',
      }),
    ).toMatchObject({
      agent: {
        kind: "custom",
        executable: "/Users/example/My Agent/bin/agent",
        args: ["--plain"],
      },
    });
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

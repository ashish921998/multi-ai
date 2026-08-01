import { describe, expect, it } from "vitest";
import { buildConnectorCommand } from "../src/lib/connectorCommand.ts";

describe("buildConnectorCommand", () => {
  it("appends a built-in harness selection", () => {
    expect(
      buildConnectorCommand("room connect ROOM123 ABCD-2345", {
        kind: "builtIn",
        name: "codex",
        supportsVision: false,
      }),
    ).toBe("room connect ROOM123 ABCD-2345 --agent codex");
  });

  it("builds a custom command without losing argument boundaries", () => {
    expect(
      buildConnectorCommand("room connect ROOM123 ABCD-2345", {
        kind: "custom",
        executable: " ./my agent ",
        args: ["run", "--plain", "two words"],
        supportsVision: false,
      }),
    ).toBe(
      "room connect ROOM123 ABCD-2345 --agent custom --command='./my agent' --arg=run --arg=--plain --arg='two words'",
    );
  });

  it("adds screenshot support when the selected model can read images", () => {
    expect(
      buildConnectorCommand("room connect ROOM123 ABCD-2345", {
        kind: "builtIn",
        name: "claude",
        supportsVision: true,
      }),
    ).toBe("room connect ROOM123 ABCD-2345 --agent claude --supports-vision");
  });

  it("does not build an incomplete custom command", () => {
    expect(
      buildConnectorCommand("room connect ROOM123 ABCD-2345", {
        kind: "custom",
        executable: "  ",
        args: [],
        supportsVision: false,
      }),
    ).toBeNull();
  });
});

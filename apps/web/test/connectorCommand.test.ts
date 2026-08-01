import { describe, expect, it } from "vitest";
import { buildConnectorCommand } from "../src/lib/connectorCommand.ts";

describe("buildConnectorCommand", () => {
  it("appends a built-in harness selection", () => {
    expect(
      buildConnectorCommand("room connect ROOM123 ABCD-2345", {
        kind: "builtIn",
        name: "codex",
      }),
    ).toBe("room connect ROOM123 ABCD-2345 --agent codex");
  });

  it("builds a custom command without losing argument boundaries", () => {
    expect(
      buildConnectorCommand("room connect ROOM123 ABCD-2345", {
        kind: "custom",
        executable: " ./my agent ",
        args: ["run", "--plain", "two words"],
      }),
    ).toBe(
      "room connect ROOM123 ABCD-2345 --agent custom --command='./my agent' --arg=run --arg=--plain --arg='two words'",
    );
  });

  it("does not build an incomplete custom command", () => {
    expect(
      buildConnectorCommand("room connect ROOM123 ABCD-2345", {
        kind: "custom",
        executable: "  ",
        args: [],
      }),
    ).toBeNull();
  });
});

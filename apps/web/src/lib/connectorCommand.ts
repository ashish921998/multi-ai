import type { HarnessName } from "@multi-ai/shared";

export type ConnectorHarnessSelection =
  | { kind: "builtIn"; name: HarnessName }
  | { kind: "custom"; executable: string; args: readonly string[] };

/** Builds a copyable POSIX-shell command while preserving custom argument boundaries. */
export function buildConnectorCommand(
  baseCommand: string,
  selection: ConnectorHarnessSelection,
): string | null {
  if (selection.kind === "builtIn") {
    return `${baseCommand} --agent ${selection.name}`;
  }

  const executable = selection.executable.trim();
  if (!executable) return null;

  const args = selection.args.map((arg) => ` --arg=${quoteShellArg(arg)}`).join("");
  return `${baseCommand} --agent custom --command=${quoteShellArg(executable)}${args}`;
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

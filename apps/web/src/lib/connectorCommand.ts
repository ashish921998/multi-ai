import type { HarnessName } from "@multi-ai/shared";

export function parseCustomArguments(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((argument) => argument.trim())
    .filter(Boolean);
}

export type ConnectorHarnessSelection = (
  | { kind: "builtIn"; name: HarnessName }
  | { kind: "custom"; executable: string; args: readonly string[] }
) & { supportsVision: boolean };

/** Builds a copyable POSIX-shell command while preserving custom argument boundaries. */
export function buildConnectorCommand(
  baseCommand: string,
  selection: ConnectorHarnessSelection,
): string | null {
  const visionFlag = selection.supportsVision ? " --supports-vision" : "";
  if (selection.kind === "builtIn") {
    return `${baseCommand} --agent ${selection.name}${visionFlag}`;
  }

  const executable = selection.executable.trim();
  if (!executable) return null;

  const args = selection.args.map((arg) => ` --arg=${quoteShellArg(arg)}`).join("");
  return `${baseCommand} --agent custom --command=${quoteShellArg(executable)}${args}${visionFlag}`;
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

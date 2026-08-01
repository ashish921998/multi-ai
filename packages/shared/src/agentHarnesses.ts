/** Public harness identities shared by the browser and local connector. */
export const BUILT_IN_AGENT_HARNESSES = [
  { id: "pi", label: "Pi" },
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "opencode", label: "OpenCode" },
] as const;

export type HarnessName = (typeof BUILT_IN_AGENT_HARNESSES)[number]["id"];

export function isHarnessName(value: string): value is HarnessName {
  return BUILT_IN_AGENT_HARNESSES.some((harness) => harness.id === value);
}

export function harnessLabel(name: HarnessName): string {
  for (const harness of BUILT_IN_AGENT_HARNESSES) {
    if (harness.id === name) return harness.label;
  }
  throw new Error(`Missing metadata for agent harness "${name}".`);
}

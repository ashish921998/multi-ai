export const HARNESS_NAMES = ["pi", "codex", "claude", "cursor", "opencode"] as const;

export type HarnessName = (typeof HARNESS_NAMES)[number];

export interface ProcessInvocation {
  executable: string;
  args: string[];
  stdin?: string;
}

/**
 * The only seam between the room connector and a coding-agent harness.
 *
 * Harnesses differ in how they accept a prompt; everything else—room leases,
 * handoffs, streaming, attachments, and document OCC—stays in the connector.
 */
export interface AgentHarness {
  name: string;
  invoke(prompt: string): ProcessInvocation;
}

const BUILT_INS: Record<HarnessName, AgentHarness> = {
  pi: {
    name: "Pi",
    invoke: (prompt) => ({
      executable: "pi",
      args: ["--print", "--no-session", prompt],
    }),
  },
  codex: {
    name: "Codex",
    invoke: (prompt) => ({
      executable: "codex",
      args: ["exec", "--ephemeral", "--sandbox", "read-only", "--color", "never", "-"],
      stdin: prompt,
    }),
  },
  claude: {
    name: "Claude Code",
    invoke: (prompt) => ({
      executable: "claude",
      args: [
        "--print",
        "--no-session-persistence",
        "--permission-mode",
        "plan",
        "--output-format",
        "text",
      ],
      stdin: prompt,
    }),
  },
  cursor: {
    name: "Cursor",
    invoke: (prompt) => ({
      executable: "cursor-agent",
      args: ["--print", "--sandbox", "enabled", "--output-format", "text", prompt],
    }),
  },
  opencode: {
    name: "OpenCode",
    invoke: (prompt) => ({
      executable: "opencode",
      args: ["run", "--format", "default", prompt],
    }),
  },
};

export function getHarness(name: string): AgentHarness {
  if (!isHarnessName(name)) {
    throw new Error(
      `Unknown agent harness "${name}". Choose one of: ${HARNESS_NAMES.join(", ")}, custom.`,
    );
  }
  return BUILT_INS[name];
}

export function customHarness(executable: string, args: string[] = []): AgentHarness {
  if (!executable.trim()) throw new Error("A custom harness requires --command <executable>.");
  return {
    name: executable,
    invoke: (prompt) => ({ executable, args, stdin: prompt }),
  };
}

function isHarnessName(value: string): value is HarnessName {
  return HARNESS_NAMES.some((name) => name === value);
}

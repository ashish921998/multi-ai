import {
  BUILT_IN_AGENT_HARNESSES,
  harnessLabel,
  isHarnessName,
  type HarnessName,
} from "@multi-ai/shared";

/**
 * Static process configuration for one coding-agent harness. Every supported
 * CLI accepts a piped prompt, so room content never enters the process argv.
 */
export interface AgentHarness {
  name: string;
  executable: string;
  args: readonly string[];
}

const BUILT_INS: Record<HarnessName, Omit<AgentHarness, "name">> = {
  pi: {
    executable: "pi",
    args: ["--print", "--no-session"],
  },
  codex: {
    executable: "codex",
    args: ["exec", "--ephemeral", "--sandbox", "read-only", "--color", "never", "-"],
  },
  claude: {
    executable: "claude",
    args: [
      "--print",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "--output-format",
      "text",
    ],
  },
  cursor: {
    executable: "cursor-agent",
    args: ["--print", "--sandbox", "enabled", "--output-format", "text"],
  },
  opencode: {
    executable: "opencode",
    args: ["run", "--format", "default"],
  },
};

export function getHarness(name: string): AgentHarness {
  if (!isHarnessName(name)) {
    const names = BUILT_IN_AGENT_HARNESSES.map((harness) => harness.id).join(", ");
    throw new Error(`Unknown agent harness "${name}". Choose one of: ${names}, custom.`);
  }
  return { name: harnessLabel(name), ...BUILT_INS[name] };
}

export function customHarness(executable: string, args: readonly string[] = []): AgentHarness {
  const normalizedExecutable = executable.trim();
  if (!normalizedExecutable) {
    throw new Error("A custom harness requires --command <executable>.");
  }
  return { name: normalizedExecutable, executable: normalizedExecutable, args };
}

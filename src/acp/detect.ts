/**
 * Agent auto-detection — scans the local machine for available coding agents.
 *
 * Ported from weclaw config/detect.go.
 * Detection priority: claude > codex > gemini > opencode
 * Binary resolution: fast path (which) → fallback (interactive shell for nvm/mise).
 */
import { execFile, exec } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { AgentConfig, AgentDetectorEntry } from "./types.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ── Agent registry (priority order, same as weclaw) ──

const AGENT_REGISTRY: AgentDetectorEntry[] = [
  {
    name: "claude",
    aliases: ["cc"],
    binaries: ["claude"],
    acpCmd: "npx",
    acpArgs: ["-y", "@agentclientprotocol/claude-agent-acp"],
    cliArgs: ["-p", "--output-format", "stream-json"],
  },
  {
    name: "codex",
    aliases: ["cx"],
    binaries: ["codex"],
    acpCmd: "npx",
    acpArgs: ["-y", "@agentclientprotocol/codex-acp"],
    cliArgs: ["exec"],
  },
  {
    name: "gemini",
    aliases: ["gm"],
    binaries: ["gemini"],
    acpCmd: "gemini",
    acpArgs: [],
  },
  {
    name: "opencode",
    aliases: ["ocd"],
    binaries: ["opencode"],
    acpCmd: "npx",
    acpArgs: ["-y", "opencode-ai", "acp"],
  },
];

// ── Public API ──

/**
 * Detect all available coding agents on this machine.
 * Returns configs for agents whose binaries were found, in priority order.
 */
export async function detectAgents(cwd?: string): Promise<AgentConfig[]> {
  const workdir = cwd ?? homedir();
  const results: AgentConfig[] = [];

  // Run all detections in parallel
  const detections = await Promise.allSettled(
    AGENT_REGISTRY.map((entry) => detectOne(entry, workdir)),
  );

  for (const result of detections) {
    if (result.status === "fulfilled" && result.value) {
      results.push(result.value);
    }
  }

  return results;
}

/** Exported for testing — the raw registry. */
export { AGENT_REGISTRY };

// ── Detection logic ──

async function detectOne(
  entry: AgentDetectorEntry,
  cwd: string,
): Promise<AgentConfig | null> {
  // Try to find the binary
  const binaryPath = await resolveBinary(entry.binaries);
  if (!binaryPath) return null;

  // Decide agent type: prefer ACP, fallback to CLI
  if (entry.acpCmd) {
    return {
      name: entry.name,
      type: "acp",
      cmd: entry.acpCmd,
      args: entry.acpArgs ?? [],
      cwd,
      env: {},
      aliases: entry.aliases,
    };
  }

  if (entry.cliArgs) {
    return {
      name: entry.name,
      type: "cli",
      cmd: binaryPath,
      args: entry.cliArgs,
      cwd,
      env: {},
      aliases: entry.aliases,
    };
  }

  if (entry.httpDefaults) {
    return {
      name: entry.name,
      type: "http",
      cmd: binaryPath,
      args: [],
      cwd,
      env: {},
      aliases: entry.aliases,
      baseUrl: entry.httpDefaults.baseUrl,
      model: entry.httpDefaults.model,
    };
  }

  return null;
}

/**
 * Resolve a binary's full path.
 *
 * Fast path: `which <binary>` in current env.
 * Fallback:  interactive shell `zsh -ic "which <binary>"` to pick up
 *            version managers (nvm, mise, asdf, etc.) — same strategy as weclaw.
 */
async function resolveBinary(names: string[]): Promise<string | null> {
  for (const name of names) {
    // Fast path
    const fast = await whichFast(name);
    if (fast) return fast;

    // Fallback: interactive shell (handles nvm, mise, etc.)
    const slow = await whichInteractive(name);
    if (slow) return slow;
  }
  return null;
}

async function whichFast(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", [name], {
      timeout: 5_000,
    });
    const path = stdout.trim();
    return path || null;
  } catch {
    return null;
  }
}

async function whichInteractive(name: string): Promise<string | null> {
  // Determine user's shell
  const shell = process.env.SHELL?.includes("zsh") ? "zsh" : "bash";
  const flag = shell === "zsh" ? "-ic" : "-lic";

  try {
    const { stdout } = await execAsync(`${shell} ${flag} "which ${name}"`, {
      timeout: 10_000,
      env: { ...process.env, HOME: homedir() },
    });
    const path = stdout.trim().split("\n").pop()?.trim();
    return path || null;
  } catch {
    return null;
  }
}

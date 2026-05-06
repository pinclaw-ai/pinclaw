/**
 * ACP Agent type definitions.
 *
 * Ported from weclaw agent/agent.go — unified interface for all agent backends.
 */

// ── Agent backend types ──

type AgentType = "acp" | "cli" | "http";

// ── Configuration ──

type AgentConfig = {
  name: string;
  type: AgentType;
  cmd: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  aliases: string[];
  // HTTP-only
  model?: string;
  systemPrompt?: string;
  baseUrl?: string;
  apiKey?: string;
};

// ── Runtime info ──

type AgentInfo = {
  name: string;
  type: AgentType;
  aliases: string[];
  running: boolean;
  cmd: string;
  pid?: number;
  model?: string;
};

// ── Unified agent interface ──

interface IAgent {
  /** Stream a response for the given conversation. Yields text chunks. */
  chat(
    conversationId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown>;

  /** Discard session state for a conversation, starting fresh next time. */
  resetSession(conversationId: string): void;

  /** Return runtime info for this agent. */
  info(): AgentInfo;

  /** Update working directory. */
  setCwd(cwd: string): void;

  /** Gracefully shut down the agent (kill subprocess, etc.). */
  stop(): void;
}

// ── Agent detector descriptor ──

type AgentDetectorEntry = {
  name: string;
  aliases: string[];
  /** Binary names to search for via `which`. */
  binaries: string[];
  /** Preferred: ACP subprocess command + args. */
  acpCmd?: string;
  acpArgs?: string[];
  /** Fallback: CLI invocation args (appended to binary path). */
  cliArgs?: string[];
  /** HTTP fallback config. */
  httpDefaults?: {
    baseUrl: string;
    model: string;
  };
};

export type { AgentType, AgentConfig, AgentInfo, IAgent, AgentDetectorEntry };

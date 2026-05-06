/**
 * CLI Agent — spawns a new process per message, tracks sessions for multi-turn.
 *
 * Ported from weclaw agent/cli_agent.go.
 * Supports:
 *   - Claude CLI:  `claude -p --output-format stream-json` with --resume for multi-turn
 *   - Codex CLI:   `codex exec <message>` with synchronous output
 *   - Generic:     simple stdin/stdout text exchange
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentConfig, AgentInfo, IAgent } from "./types.js";

export class CliAgent implements IAgent {
  private config: AgentConfig;
  private sessions = new Map<string, string>(); // conversationId → sessionId

  constructor(config: AgentConfig) {
    this.config = config;
  }

  // ── IAgent interface ──

  async *chat(
    conversationId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    if (this.config.name === "claude") {
      yield* this.chatClaude(conversationId, message, signal);
    } else if (this.config.name === "codex") {
      yield* this.chatCodex(message, signal);
    } else {
      yield* this.chatGeneric(message, signal);
    }
  }

  resetSession(conversationId: string): void {
    this.sessions.delete(conversationId);
  }

  info(): AgentInfo {
    return {
      name: this.config.name,
      type: "cli",
      aliases: this.config.aliases,
      running: true,
      cmd: this.config.cmd,
    };
  }

  setCwd(cwd: string): void {
    this.config.cwd = cwd;
  }

  stop(): void {
    this.sessions.clear();
  }

  // ── Claude CLI ──

  private async *chatClaude(
    conversationId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const args = ["-p", message, "--output-format", "stream-json"];

    // Resume existing session
    const sessionId = this.sessions.get(conversationId);
    if (sessionId) {
      args.push("--resume", sessionId);
    }

    const proc = spawn(this.config.cmd, args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    signal?.addEventListener(
      "abort",
      () => {
        proc.kill("SIGTERM");
      },
      { once: true },
    );

    const rl = createInterface({ input: proc.stdout! });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);

        // Extract session ID for future resume
        if (event.session_id) {
          this.sessions.set(conversationId, event.session_id);
        }

        // Extract text content from various Claude output formats
        const text = extractClaudeText(event);
        if (text) yield text;
      } catch {
        // Non-JSON line — yield as plain text
        if (trimmed) yield trimmed;
      }
    }

    // Wait for process to exit
    await new Promise<void>((resolve) => {
      proc.on("exit", () => resolve());
    });
  }

  // ── Codex CLI ──

  private async *chatCodex(
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const args = [...this.config.args, message];

    const proc = spawn(this.config.cmd, args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    signal?.addEventListener(
      "abort",
      () => {
        proc.kill("SIGTERM");
      },
      { once: true },
    );

    // Codex outputs plain text
    const rl = createInterface({ input: proc.stdout! });
    for await (const line of rl) {
      yield line + "\n";
    }

    await new Promise<void>((resolve) => {
      proc.on("exit", () => resolve());
    });
  }

  // ── Generic CLI ──

  private async *chatGeneric(
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const args = [...this.config.args, message];

    const proc = spawn(this.config.cmd, args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    signal?.addEventListener(
      "abort",
      () => {
        proc.kill("SIGTERM");
      },
      { once: true },
    );

    const rl = createInterface({ input: proc.stdout! });
    for await (const line of rl) {
      yield line + "\n";
    }

    await new Promise<void>((resolve) => {
      proc.on("exit", () => resolve());
    });
  }
}

// ── Helpers ──

/**
 * Extract text content from Claude's stream-json events.
 * Handles: assistant message blocks, result objects, content_block_delta, etc.
 */
function extractClaudeText(event: Record<string, unknown>): string {
  // { type: "content_block_delta", delta: { text: "..." } }
  if (event.type === "content_block_delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta?.text) return delta.text as string;
  }

  // { type: "assistant", content: [{ type: "text", text: "..." }] }
  if (event.type === "assistant" && Array.isArray(event.content)) {
    return (event.content as Array<Record<string, unknown>>)
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text as string)
      .join("");
  }

  // { result: "..." } or { result: { content: "..." } }
  if (event.result) {
    if (typeof event.result === "string") return event.result;
    const result = event.result as Record<string, unknown>;
    if (typeof result.content === "string") return result.content;
  }

  // { type: "text", text: "..." }
  if (event.type === "text" && typeof event.text === "string") {
    return event.text;
  }

  return "";
}

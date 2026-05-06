/**
 * ACP Agent — long-running subprocess communicating via JSON-RPC 2.0 over stdio.
 *
 * Ported from weclaw agent/acp_agent.go.
 * Supports two protocol variants:
 *   - legacy_acp:        session/new  + session/prompt   (Claude, OpenCode)
 *   - codex_app_server:  thread/start + turn/start       (Codex)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentConfig, AgentInfo, IAgent } from "./types.js";
import {
  makeRequest,
  isResponse,
  isNotification,
  type JsonRpcResponse,
  type JsonRpcNotification,
} from "./protocol.js";

type AcpProtocol = "legacy_acp" | "codex_app_server";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SessionListener = {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
};

const HANDSHAKE_TIMEOUT_MS = 30_000;
const RPC_TIMEOUT_MS = 120_000;

export class AcpAgent implements IAgent {
  private config: AgentConfig;
  private process: ChildProcess | null = null;
  private rpcId = 0;
  private protocol: AcpProtocol = "legacy_acp";
  private pendingCalls = new Map<number, PendingCall>();
  private sessionListeners = new Map<string, SessionListener>();
  private sessions = new Map<string, string>(); // conversationId → sessionId
  private started = false;
  private stderr = "";

  constructor(config: AgentConfig) {
    this.config = config;
  }

  // ── Lifecycle ──

  async start(): Promise<void> {
    if (this.started) return;

    const proc = spawn(this.config.cmd, this.config.args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process = proc;

    // Capture stderr for diagnostics
    proc.stderr?.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
      // Keep only last 4KB
      if (this.stderr.length > 4096) {
        this.stderr = this.stderr.slice(-4096);
      }
    });

    proc.on("exit", (code) => {
      this.started = false;
      // Reject all pending calls
      for (const [id, pending] of this.pendingCalls) {
        pending.reject(
          new Error(
            `ACP process exited with code ${code}: ${this.stderr.slice(-500)}`,
          ),
        );
        clearTimeout(pending.timer);
        this.pendingCalls.delete(id);
      }
    });

    this.startReadLoop(proc);

    // Handshake: send initialize, detect protocol
    await this.handshake();
    this.started = true;
  }

  stop(): void {
    this.started = false;
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    for (const [, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Agent stopped"));
    }
    this.pendingCalls.clear();
    this.sessions.clear();
  }

  // ── IAgent interface ──

  async *chat(
    conversationId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    if (!this.started) await this.start();

    // Get or create session
    let sessionId = this.sessions.get(conversationId);
    if (!sessionId) {
      sessionId = await this.createSession();
      this.sessions.set(conversationId, sessionId);
    }

    // Stream response
    yield* this.streamPrompt(sessionId, message, signal);
  }

  resetSession(conversationId: string): void {
    this.sessions.delete(conversationId);
  }

  info(): AgentInfo {
    return {
      name: this.config.name,
      type: "acp",
      aliases: this.config.aliases,
      running: this.started,
      cmd: this.config.cmd,
      pid: this.process?.pid,
    };
  }

  setCwd(cwd: string): void {
    this.config.cwd = cwd;
  }

  // ── Protocol ──

  private async handshake(): Promise<void> {
    const result = (await this.rpcCall(
      "initialize",
      {
        protocolVersion: 1,
        client_info: { name: "pinclaw", version: "0.1.0" },
        capabilities: {},
      },
      HANDSHAKE_TIMEOUT_MS,
    )) as Record<string, unknown> | null;

    // Detect protocol variant from response capabilities
    if (result && typeof result === "object") {
      const agentCaps = result.agentCapabilities as
        | Record<string, unknown>
        | undefined;
      const caps = result.capabilities as Record<string, unknown> | undefined;
      // Codex uses thread/turn based protocol
      if (
        agentCaps?.threads ||
        agentCaps?.turns ||
        caps?.threads ||
        caps?.turns
      ) {
        this.protocol = "codex_app_server";
      }
    }
  }

  private async createSession(): Promise<string> {
    if (this.protocol === "codex_app_server") {
      const result = (await this.rpcCall("thread/start", {})) as Record<
        string,
        unknown
      >;
      return (result?.thread_id as string) ?? (result?.id as string) ?? "";
    }
    // ACP spec requires cwd and mcpServers for session/new
    const result = (await this.rpcCall("session/new", {
      cwd: this.config.cwd,
      mcpServers: [],
    })) as Record<string, unknown>;
    return (
      (result?.sessionId as string) ??
      (result?.session_id as string) ??
      (result?.id as string) ??
      ""
    );
  }

  private async *streamPrompt(
    sessionId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const method =
      this.protocol === "codex_app_server" ? "turn/start" : "session/prompt";
    const paramKey =
      this.protocol === "codex_app_server" ? "thread_id" : "sessionId";

    // Create a channel for streaming chunks
    const chunks: string[] = [];
    let done = false;
    let error: Error | null = null;
    let notify: (() => void) | null = null;

    const listenerId = `${sessionId}-${Date.now()}`;
    this.sessionListeners.set(listenerId, {
      onChunk: (text) => {
        chunks.push(text);
        notify?.();
      },
      onDone: () => {
        done = true;
        notify?.();
      },
      onError: (err) => {
        error = err;
        done = true;
        notify?.();
      },
    });

    // ACP spec: session/prompt uses "prompt" as ContentBlock[] array
    // Codex uses "content" as plain string
    const promptParams: Record<string, unknown> =
      this.protocol === "codex_app_server"
        ? { [paramKey]: sessionId, content }
        : { [paramKey]: sessionId, prompt: [{ type: "text", text: content }] };

    // Send the prompt — text arrives via session/update notifications,
    // and the JSON-RPC response signals completion (stopReason: "end_turn")
    const rpcPromise = this.rpcCall(method, promptParams)
      .then(() => {
        // RPC response received = prompt completed
        done = true;
        notify?.();
      })
      .catch((err) => {
        error = err;
        done = true;
        notify?.();
      });

    // Handle abort
    const abortHandler = () => {
      error = new Error("Aborted");
      done = true;
      notify?.();
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    try {
      // Yield chunks as they arrive
      while (!done || chunks.length > 0) {
        if (chunks.length > 0) {
          yield chunks.shift()!;
          continue;
        }
        if (done) break;
        // Wait for next event
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
      if (error) throw error;
    } finally {
      this.sessionListeners.delete(listenerId);
      signal?.removeEventListener("abort", abortHandler);
      // Don't block on rpcPromise — the ACP server may only send
      // notifications (session/text + session/done) without a JSON-RPC
      // response for session/prompt. Swallow any late resolution/rejection.
      rpcPromise.catch(() => {});
    }
  }

  // ── JSON-RPC transport ──

  private rpcCall(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = RPC_TIMEOUT_MS,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("ACP process not running"));
        return;
      }

      const id = ++this.rpcId;
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingCalls.set(id, { resolve, reject, timer });
      this.process.stdin.write(makeRequest(id, method, params));
    });
  }

  private startReadLoop(proc: ChildProcess): void {
    if (!proc.stdout) return;

    const rl = createInterface({ input: proc.stdout });

    rl.on("line", (line) => {
      this.handleLine(line);
    });

    rl.on("close", () => {
      // Process ended — handled by "exit" event
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }

    // JSON-RPC response (has "id")
    if ("id" in msg && typeof msg.id === "number") {
      const resp = msg as unknown as JsonRpcResponse;
      const pending = this.pendingCalls.get(resp.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCalls.delete(resp.id);
        if (resp.error) {
          pending.reject(new Error(resp.error.message));
        } else {
          pending.resolve(resp.result ?? null);
        }
      }
      return;
    }

    // JSON-RPC notification (has "method", no "id")
    if ("method" in msg) {
      const notif = msg as unknown as JsonRpcNotification;
      this.handleNotification(notif);
      return;
    }
  }

  private handleNotification(notif: JsonRpcNotification): void {
    const params = (notif.params ?? {}) as Record<string, unknown>;

    // Permission request → auto-approve (same as weclaw)
    if (
      notif.method === "permission/request" ||
      notif.method === "notifications/permission"
    ) {
      const approvalId =
        (params.id as string) ?? (params.approval_id as string);
      if (approvalId && this.process?.stdin?.writable) {
        this.process.stdin.write(
          makeRequest(++this.rpcId, "permission/approve", { id: approvalId }),
        );
      }
      return;
    }

    // ACP session/update — the primary notification channel for Claude Code ACP.
    // Types: agent_message_chunk (text), usage_update, available_commands_update
    if (notif.method === "session/update") {
      const update = params.update as Record<string, unknown> | undefined;
      if (!update) return;

      const updateType = update.sessionUpdate as string;
      if (updateType === "agent_message_chunk") {
        const content = update.content as Record<string, unknown> | undefined;
        const text = (content?.text as string) ?? "";
        if (text) {
          for (const listener of this.sessionListeners.values()) {
            listener.onChunk(text);
          }
        }
      }
      // Other update types (usage_update, available_commands_update) are ignored
      return;
    }

    // Legacy text chunk notification (Codex / older ACP implementations)
    if (
      notif.method === "notifications/text" ||
      notif.method === "session/text" ||
      notif.method === "turn/text"
    ) {
      const contentBlock = params.contentBlock as
        | Record<string, unknown>
        | undefined;
      const text =
        (contentBlock?.text as string) ??
        (params.content as string) ??
        (params.text as string) ??
        "";
      if (text) {
        for (const listener of this.sessionListeners.values()) {
          listener.onChunk(text);
        }
      }
      return;
    }

    // Done notification (legacy — modern ACP uses JSON-RPC response for done)
    if (
      notif.method === "notifications/done" ||
      notif.method === "session/done" ||
      notif.method === "turn/done" ||
      notif.method === "session/complete" ||
      notif.method === "turn/complete"
    ) {
      for (const listener of this.sessionListeners.values()) {
        listener.onDone();
      }
      return;
    }

    // Error notification
    if (
      notif.method === "notifications/error" ||
      notif.method === "session/error" ||
      notif.method === "turn/error"
    ) {
      const errMsg = (params.message as string) ?? "Unknown ACP error";
      for (const listener of this.sessionListeners.values()) {
        listener.onError(new Error(errMsg));
      }
      return;
    }
  }
}

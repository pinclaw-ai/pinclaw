/**
 * HTTP Agent — OpenAI-compatible chat completions API.
 *
 * Ported from weclaw agent/http_agent.go.
 * Maintains per-conversation history (20 messages max).
 */
import type { AgentConfig, AgentInfo, IAgent } from "./types.js";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const MAX_HISTORY = 20;

export class HttpAgent implements IAgent {
  private config: AgentConfig;
  private history = new Map<string, ChatMessage[]>();

  constructor(config: AgentConfig) {
    this.config = config;
  }

  // ── IAgent interface ──

  async *chat(
    conversationId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const messages = this.buildMessages(conversationId, message);

    const baseUrl = (this.config.baseUrl ?? "").replace(/\/+$/, "");
    const url = `${baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model ?? "default",
        messages,
        stream: true,
      }),
      signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    // Parse SSE stream
    const fullResponse = yield* this.parseSSEStream(resp, signal);

    // Append to history
    this.appendToHistory(conversationId, message, fullResponse);
  }

  resetSession(conversationId: string): void {
    this.history.delete(conversationId);
  }

  info(): AgentInfo {
    return {
      name: this.config.name,
      type: "http",
      aliases: this.config.aliases,
      running: true,
      cmd: this.config.cmd,
      model: this.config.model,
    };
  }

  setCwd(cwd: string): void {
    this.config.cwd = cwd;
  }

  stop(): void {
    this.history.clear();
  }

  // ── Internals ──

  private buildMessages(
    conversationId: string,
    message: string,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];

    if (this.config.systemPrompt) {
      messages.push({ role: "system", content: this.config.systemPrompt });
    }

    const existing = this.history.get(conversationId) ?? [];
    messages.push(...existing);
    messages.push({ role: "user", content: message });

    return messages;
  }

  private appendToHistory(
    conversationId: string,
    userMsg: string,
    assistantMsg: string,
  ): void {
    const hist = this.history.get(conversationId) ?? [];
    hist.push({ role: "user", content: userMsg });
    hist.push({ role: "assistant", content: assistantMsg });

    // Trim to max — keep system prompt separate, only trim conversation
    while (hist.length > MAX_HISTORY) {
      hist.shift();
    }

    this.history.set(conversationId, hist);
  }

  private async *parseSSEStream(
    resp: Response,
    signal?: AbortSignal,
  ): AsyncGenerator<string, string, unknown> {
    let full = "";

    if (!resp.body) {
      return full;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        if (signal?.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              full += delta;
              yield delta;
            }
          } catch {
            // Malformed SSE data line — skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return full;
  }
}

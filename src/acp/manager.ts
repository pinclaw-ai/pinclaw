/**
 * Agent Manager — orchestrates detection, lifecycle, and routing for all ACP agents.
 *
 * This is the single entry point used by the plugin's WS handler.
 */
import type { AgentConfig, AgentInfo, IAgent } from "./types.js";
import { AcpAgent } from "./acp-agent.js";
import { CliAgent } from "./cli-agent.js";
import { HttpAgent } from "./http-agent.js";
import { detectAgents } from "./detect.js";

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export class AgentManager {
  private agents = new Map<string, IAgent>();
  private aliases = new Map<string, string>(); // alias → agent name
  private configs: AgentConfig[] = [];
  private log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  // ── Lifecycle ──

  /**
   * Detect available agents and initialize them.
   * ACP agents are started (long-running subprocess); CLI/HTTP are lazy.
   */
  async init(cwd?: string): Promise<void> {
    this.log.info("[acp] Detecting available coding agents...");

    this.configs = await detectAgents(cwd);

    if (this.configs.length === 0) {
      this.log.info("[acp] No coding agents detected on this machine.");
      return;
    }

    for (const config of this.configs) {
      const agent = this.createAgent(config);
      this.agents.set(config.name, agent);

      // Register aliases
      for (const alias of config.aliases) {
        this.aliases.set(alias, config.name);
      }

      // Start ACP agents eagerly (they're long-running subprocesses)
      if (config.type === "acp" && agent instanceof AcpAgent) {
        try {
          await agent.start();
          this.log.info(
            `[acp] Started ${config.name} (ACP, pid=${agent.info().pid})`,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.warn(
            `[acp] Failed to start ${config.name} ACP, will retry on first use: ${msg}`,
          );
        }
      } else {
        this.log.info(`[acp] Registered ${config.name} (${config.type})`);
      }
    }

    this.log.info(
      `[acp] ${this.agents.size} agent(s) available: ${[...this.agents.keys()].join(", ")}`,
    );
  }

  /** Shut down all agents. */
  stopAll(): void {
    for (const agent of this.agents.values()) {
      agent.stop();
    }
    this.agents.clear();
    this.aliases.clear();
    this.configs = [];
    this.log.info("[acp] All agents stopped.");
  }

  // ── Query ──

  /** List all available agents with runtime info. */
  listAvailable(): AgentInfo[] {
    return [...this.agents.values()].map((a) => a.info());
  }

  /** Check if any agents are available. */
  get hasAgents(): boolean {
    return this.agents.size > 0;
  }

  /** Resolve agent name or alias to the canonical name. */
  resolve(nameOrAlias: string): string | null {
    const lower = nameOrAlias.toLowerCase();
    if (this.agents.has(lower)) return lower;
    return this.aliases.get(lower) ?? null;
  }

  // ── Chat ──

  /**
   * Stream a chat response from the specified agent.
   * Accepts agent name or alias.
   */
  async *chat(
    nameOrAlias: string,
    conversationId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const name = this.resolve(nameOrAlias);
    if (!name) {
      throw new Error(
        `Agent "${nameOrAlias}" not available. Available: ${[...this.agents.keys()].join(", ")}`,
      );
    }

    const agent = this.agents.get(name)!;
    this.log.info(`[acp] ${name}: chat start (conversation=${conversationId})`);

    try {
      yield* agent.chat(conversationId, message, signal);
      this.log.info(`[acp] ${name}: chat complete`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`[acp] ${name}: chat error: ${msg}`);
      throw err;
    }
  }

  /** Reset an agent's session for a given conversation. */
  resetSession(nameOrAlias: string, conversationId: string): void {
    const name = this.resolve(nameOrAlias);
    if (!name) return;
    this.agents.get(name)?.resetSession(conversationId);
    this.log.info(
      `[acp] ${name}: session reset (conversation=${conversationId})`,
    );
  }

  /** Update working directory for all agents. */
  setCwd(cwd: string): void {
    for (const agent of this.agents.values()) {
      agent.setCwd(cwd);
    }
  }

  // ── Factory ──

  private createAgent(config: AgentConfig): IAgent {
    switch (config.type) {
      case "acp":
        return new AcpAgent(config);
      case "cli":
        return new CliAgent(config);
      case "http":
        return new HttpAgent(config);
    }
  }
}

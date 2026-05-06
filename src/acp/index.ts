/**
 * ACP module — coding agent management for Pinclaw plugin.
 *
 * Ported from github.com/fastclaw-ai/weclaw (Go → TypeScript).
 * Provides detection, lifecycle, and streaming chat for external coding agents
 * (Claude Code, Codex, Gemini CLI, OpenCode) without modifying OpenClaw itself.
 */
export { AgentManager } from "./manager.js";
export { detectAgents, AGENT_REGISTRY } from "./detect.js";
export { AcpAgent } from "./acp-agent.js";
export { CliAgent } from "./cli-agent.js";
export { HttpAgent } from "./http-agent.js";
export type { AgentType, AgentConfig, AgentInfo, IAgent } from "./types.js";

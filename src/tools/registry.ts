import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Logger } from "../core/utils.js";
import type { ServerToolDef, ToolExecutionContext } from "./types.js";

const WORKSPACE_TOOLS_PATH = join(homedir(), "clawd", "TOOLS.md");
const SERVER_TOOLS_MARKER_START = "<!-- PINCLAW:SERVER_TOOLS:START -->";
const SERVER_TOOLS_MARKER_END = "<!-- PINCLAW:SERVER_TOOLS:END -->";

const EXCLUDED_FILES = new Set([
  "registry.ts",
  "registry.js",
  "types.ts",
  "types.js",
]);

export class ToolRegistry {
  private tools = new Map<string, ServerToolDef>();
  private log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  register(tool: ServerToolDef): void {
    if (this.tools.has(tool.name)) {
      this.log.warn(
        `Server tool "${tool.name}" already registered, overwriting`,
      );
    }
    this.tools.set(tool.name, tool);
    this.log.info(`Server tool registered: ${tool.name}`);
  }

  async discoverAndLoad(toolsDir: string): Promise<void> {
    let entries: string[];
    try {
      entries = readdirSync(toolsDir);
    } catch {
      this.log.info(
        `Tools directory not found: ${toolsDir} — skipping auto-discovery`,
      );
      return;
    }

    for (const file of entries) {
      // Skip excluded files and files starting with underscore
      if (file.startsWith("_")) continue;
      if (EXCLUDED_FILES.has(file)) continue;
      if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;

      const filePath = join(toolsDir, file);
      try {
        const mod = await import(filePath);
        const tool: ServerToolDef | undefined = mod.default ?? mod.tool;
        if (tool && tool.name && typeof tool.execute === "function") {
          this.register(tool);
        } else {
          this.log.warn(
            `Tool file ${file} does not export a valid ServerToolDef (needs default or "tool" export with name + execute)`,
          );
        }
      } catch (err: any) {
        this.log.error(`Failed to load tool from ${file}: ${err.message}`);
      }
    }

    this.log.info(`Tool registry: ${this.tools.size} tool(s) loaded`);
    this.syncToWorkspace();
  }

  getAll(): ServerToolDef[] {
    return Array.from(this.tools.values());
  }

  get(name: string): ServerToolDef | undefined {
    return this.tools.get(name);
  }

  async execute(
    name: string,
    params: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Server tool not found: ${name}`);
    }
    return tool.execute(params, context);
  }

  buildPromptBlock(): string {
    const tools = this.getAll();
    if (tools.length === 0) return "";

    const toolLines = tools
      .map((t) => {
        const paramDesc =
          t.parameters.length > 0
            ? ` (params: ${t.parameters.map((p) => `${p.name}: ${p.type}${p.required === false ? "?" : ""}`).join(", ")})`
            : "";
        return `- ${t.name}: ${t.description}${paramDesc}`;
      })
      .join("\n");

    return `## Server Tools (Pinclaw plugin extras)
These are additional server-side tools provided by the Pinclaw plugin. They supplement your native OpenClaw tools (exec, read, write, etc.).
To call a server tool, output:
<server_tool name="tool_name" params='{"key":"value"}'/>

Plugin tools:
${toolLines}

Rules:
- Only call one tool at a time. Wait for the result before calling another.
- After receiving tool results, compose a natural response for the user.`;
  }

  /** Write server tools block into ~/clawd/TOOLS.md between marker comments. */
  private syncToWorkspace(): void {
    const block = this.buildPromptBlock();
    if (!block) return;
    try {
      let existing = "";
      try {
        existing = readFileSync(WORKSPACE_TOOLS_PATH, "utf-8");
      } catch {
        /* file may not exist */
      }

      const markerContent = `${SERVER_TOOLS_MARKER_START}\n${block}\n${SERVER_TOOLS_MARKER_END}`;

      const startIdx = existing.indexOf(SERVER_TOOLS_MARKER_START);
      const endIdx = existing.indexOf(SERVER_TOOLS_MARKER_END);

      let updated: string;
      if (startIdx !== -1 && endIdx !== -1) {
        updated =
          existing.slice(0, startIdx) +
          markerContent +
          existing.slice(endIdx + SERVER_TOOLS_MARKER_END.length);
      } else {
        updated = existing.trimEnd() + "\n\n" + markerContent + "\n";
      }

      writeFileSync(WORKSPACE_TOOLS_PATH, updated, "utf-8");
      this.log.info(
        `[workspace] Synced server tools to ${WORKSPACE_TOOLS_PATH}`,
      );
    } catch (err: any) {
      this.log.warn(`[workspace] Failed to sync server tools: ${err.message}`);
    }
  }
}

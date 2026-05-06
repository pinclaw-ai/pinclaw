import type { Logger } from "./utils.js";
import type { DeviceManager } from "./device-manager.js";
import type { GatewayRpc } from "./gateway-rpc.js";
import type { ToolRegistry } from "../tools/registry.js";

// ── Image URL isolation helpers ──

/** Regex matching markdown image syntax: ![alt](url) */
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

/**
 * Truncate LLM output after the first tool-call tag.
 * Weak models often continue generating *after* the self-closing tag,
 * hallucinating a "result" that copies stale URLs from conversation history.
 * Keeping only the text up to (and including) the tag prevents that.
 */
function truncateAfterToolCall(text: string): string {
  // Match the self-closing tag for either device_tool or server_tool
  const tagRe = /<(?:device_tool|server_tool)\s+[^>]*\/>/;
  const m = tagRe.exec(text);
  if (!m) return text;
  return text.slice(0, m.index + m[0].length);
}

/**
 * Extract all URL-like strings from tool result text.
 * These are the *actually generated* URLs that we trust.
 */
function extractUrlsFromToolResult(resultText: string): string[] {
  const urls: string[] = [];
  // Absolute URLs
  const absRe = /https?:\/\/[^\s)"']+/g;
  let hit: RegExpExecArray | null;
  while ((hit = absRe.exec(resultText))) urls.push(hit[0]);
  // Relative /media/generated/... paths
  const relRe = /\/media\/generated\/[^\s)"']+/g;
  while ((hit = relRe.exec(resultText))) urls.push(hit[0]);
  // data: URIs (keep just the scheme check, full URI is self-contained)
  if (resultText.includes("data:image/")) urls.push("data:");
  return urls;
}

/**
 * Remove markdown image references whose URL was NOT produced by a tool
 * in the current pipeline run.  Prevents the LLM from surfacing stale
 * or hallucinated image URLs copied from conversation history.
 */
function sanitizeImageUrls(text: string, allowedUrls: Set<string>): string {
  if (allowedUrls.size === 0) return text;
  return text
    .replace(MD_IMAGE_RE, (match, url: string) => {
      // data: URIs are self-contained — always safe
      if (url.startsWith("data:")) return match;
      // Check exact match or prefix match (query-param variations)
      for (const allowed of allowedUrls) {
        if (
          url === allowed ||
          url.startsWith(allowed) ||
          allowed.startsWith(url)
        )
          return match;
      }
      // Unknown URL — strip it
      return "";
    })
    .replace(/\n{3,}/g, "\n\n"); // collapse blank lines left by removal
}

export function parseDeviceToolCall(
  text: string,
): { toolName: string; params: Record<string, any> } | null {
  // Try strict format first: params='...'
  let match = text.match(
    /<device_tool\s+name="([^"]+)"\s+params='([^']*)'\s*\/>/,
  );
  // Fallback: params="..." (double quotes)
  if (!match)
    match = text.match(
      /<device_tool\s+name="([^"]+)"\s+params="([^"]*)"\s*\/>/,
    );
  // Fallback: params={...} (no quotes — common with empty params)
  if (!match)
    match = text.match(
      /<device_tool\s+name="([^"]+)"\s+params=(\{[^}]*\})\s*\/>/,
    );
  // Fallback: no params at all
  if (!match) match = text.match(/<device_tool\s+name="([^"]+)"\s*\/>/);
  if (!match) return null;
  try {
    return { toolName: match[1], params: JSON.parse(match[2] || "{}") };
  } catch {
    return { toolName: match[1], params: {} };
  }
}

export function parseServerToolCall(
  text: string,
): { toolName: string; params: Record<string, any> } | null {
  let match = text.match(
    /<server_tool\s+name="([^"]+)"\s+params='([^']*)'\s*\/>/,
  );
  if (!match)
    match = text.match(
      /<server_tool\s+name="([^"]+)"\s+params="([^"]*)"\s*\/>/,
    );
  if (!match)
    match = text.match(
      /<server_tool\s+name="([^"]+)"\s+params=(\{[^}]*\})\s*\/>/,
    );
  if (!match) match = text.match(/<server_tool\s+name="([^"]+)"\s*\/>/);
  if (!match) return null;
  try {
    return { toolName: match[1], params: JSON.parse(match[2] || "{}") };
  } catch {
    return { toolName: match[1], params: {} };
  }
}

export interface ToolEvent {
  tool: string;
  status: "running" | "completed" | "error";
  params?: Record<string, any>;
  result?: string;
}

export async function callAgent(
  deviceId: string,
  text: string,
  deps: {
    gatewayRpc: GatewayRpc;
    deviceManager: DeviceManager;
    toolRegistry: ToolRegistry;
    log: Logger;
    mediaPaths?: string[];
    onToolEvent?: (event: ToolEvent) => void;
    onPipelineStatus?: (status: "thinking" | "complete") => void;
  },
): Promise<{ content?: string; error?: string }> {
  const { gatewayRpc, deviceManager, toolRegistry, log, mediaPaths } = deps;

  if (!gatewayRpc.isReady) {
    return { error: "Gateway not connected" };
  }

  // Build message with media references for Gateway media understanding
  let message = text;
  if (mediaPaths?.length) {
    const mediaRefs = mediaPaths.map((p) => `MEDIA:${p}`).join("\n");
    message = mediaRefs + (text ? `\n${text}` : "");
    log.info(
      `[ai-pipeline] Sending message with ${mediaPaths.length} media attachment(s)`,
    );
  }

  // Device tools + server tools context is now synced to ~/clawd/TOOLS.md
  // (gateway reads workspace files as system context — no need to inject into user messages)

  // Signal: AI is now thinking
  deps.onPipelineStatus?.("thinking");

  let aiContent: string;
  const MAX_RETRIES = 1;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      aiContent = await gatewayRpc.chatSend("main", message);
    } catch (err: any) {
      const isEmptyResponse = err.message === "Empty agent response";
      if (isEmptyResponse && attempt < MAX_RETRIES) {
        log.info(
          `[ai-pipeline] Empty response from model, retrying (${attempt + 1}/${MAX_RETRIES})...`,
        );
        continue;
      }
      return { error: `Gateway RPC failed: ${err.message}` };
    }
    if (aiContent) break;
    if (attempt < MAX_RETRIES) {
      log.info(
        `[ai-pipeline] Empty AI content, retrying (${attempt + 1}/${MAX_RETRIES})...`,
      );
      continue;
    }
    return { error: "Empty AI response" };
  }

  // Tool call loop (max 3 rounds) — supports both device tools and server tools
  const deviceToolsList = deviceManager.getDeviceTools(deviceId);
  const hasDeviceTools = deviceToolsList.length > 0;
  const hasServerTools = toolRegistry.getAll().length > 0;

  // Track URLs actually produced by tool executions in this pipeline run.
  // Used to strip hallucinated / stale URLs from the final LLM response.
  const generatedUrls = new Set<string>();

  if (hasDeviceTools || hasServerTools) {
    let currentContent = aiContent;
    for (let round = 0; round < 3; round++) {
      // 1. Check for device tool call
      const deviceCall = parseDeviceToolCall(currentContent);
      if (deviceCall) {
        // Truncate hallucinated text after the tool-call tag
        currentContent = truncateAfterToolCall(currentContent);
        log.info(
          `AI requested device tool: ${deviceCall.toolName} (round ${round + 1})`,
        );
        deps.onToolEvent?.({
          tool: deviceCall.toolName,
          status: "running",
          params: deviceCall.params,
        });

        let toolResultText: string;
        let toolSuccess = true;
        try {
          const result = await deviceManager.callDeviceTool(
            deviceId,
            deviceCall.toolName,
            deviceCall.params,
          );
          toolResultText = result.success
            ? (result.result ?? "Success")
            : `Error: ${result.error ?? "Unknown error"}`;
          toolSuccess = result.success;
        } catch (err: any) {
          toolResultText = `Error: ${err.message}`;
          toolSuccess = false;
        }
        // Track URLs from tool result
        for (const u of extractUrlsFromToolResult(toolResultText))
          generatedUrls.add(u);
        deps.onToolEvent?.({
          tool: deviceCall.toolName,
          status: toolSuccess ? "completed" : "error",
          result: toolResultText,
        });

        const followUp = `[Tool result for ${deviceCall.toolName}]: ${toolResultText}\n\nBased on this result, respond to the user.`;
        deps.onPipelineStatus?.("thinking");
        try {
          currentContent = await gatewayRpc.chatSend("main", followUp);
        } catch {
          currentContent = toolResultText;
          break;
        }
        continue;
      }

      // 2. Check for server tool call
      const serverCall = parseServerToolCall(currentContent);
      if (serverCall) {
        // Truncate hallucinated text after the tool-call tag
        currentContent = truncateAfterToolCall(currentContent);
        log.info(
          `AI requested server tool: ${serverCall.toolName} (round ${round + 1})`,
        );
        deps.onToolEvent?.({
          tool: serverCall.toolName,
          status: "running",
          params: serverCall.params,
        });

        let toolResultText: string;
        let toolSuccess = true;
        try {
          toolResultText = await toolRegistry.execute(
            serverCall.toolName,
            serverCall.params,
            {
              deviceId,
              log,
              gatewayRpc: (method, params) => gatewayRpc.rpc(method, params),
            },
          );
        } catch (err: any) {
          toolResultText = `Error: ${err.message}`;
          toolSuccess = false;
        }
        // Track URLs from tool result
        for (const u of extractUrlsFromToolResult(toolResultText))
          generatedUrls.add(u);
        deps.onToolEvent?.({
          tool: serverCall.toolName,
          status: toolSuccess ? "completed" : "error",
          result: toolResultText,
        });

        const followUp = `[Tool result for ${serverCall.toolName}]: ${toolResultText}\n\nBased on this result, respond to the user.`;
        deps.onPipelineStatus?.("thinking");
        try {
          currentContent = await gatewayRpc.chatSend("main", followUp);
        } catch {
          currentContent = toolResultText;
          break;
        }
        continue;
      }

      // 3. No tool calls found — done
      break;
    }
    // Sanitize: strip any image URLs that weren't produced by tools this run
    if (generatedUrls.size > 0) {
      currentContent = sanitizeImageUrls(currentContent, generatedUrls);
    }
    return { content: currentContent };
  }

  return { content: aiContent };
}

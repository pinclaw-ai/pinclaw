/**
 * JSON-RPC 2.0 protocol primitives for ACP communication.
 *
 * Shared by acp-agent (as client) — kept minimal and reusable.
 */

// ── JSON-RPC 2.0 types ──

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;

// ── Helpers ──

function makeRequest(
  id: number,
  method: string,
  params?: Record<string, unknown>,
): string {
  const req: JsonRpcRequest = { jsonrpc: "2.0", id, method };
  if (params) req.params = params;
  return JSON.stringify(req) + "\n";
}

function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg;
}

function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return !("id" in msg) && "method" in msg;
}

function parseJsonRpcLine(line: string): JsonRpcMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    return null;
  }
}

export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcMessage,
};
export { makeRequest, isResponse, isNotification, parseJsonRpcLine };

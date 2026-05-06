/**
 * memory-edit — Lets the AI read, write, and list memory files in the workspace.
 *
 * Memory files live in ~/clawd/memory/*.md (the OpenClaw workspace memory dir).
 * This tool gives the AI direct file access without needing `exec`.
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join, resolve, basename, extname } from "node:path";
import { homedir } from "node:os";
import type { ServerToolDef } from "./types.js";

const MEMORY_DIR = join(homedir(), "clawd", "memory");

function ensureMemoryDir(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function safePath(filename: string): string {
  // Prevent path traversal — only allow simple filenames
  const base = basename(filename);
  if (base !== filename || filename.includes("..")) {
    throw new Error(
      `Invalid filename: "${filename}". Use a simple name like "notes.md".`,
    );
  }
  // Enforce .md extension
  if (extname(base) !== ".md") {
    throw new Error(`Only .md files are allowed. Got: "${filename}"`);
  }
  return join(MEMORY_DIR, base);
}

const tool: ServerToolDef = {
  name: "memory_edit",
  description:
    "Read, write, or list memory files (~/clawd/memory/*.md). " +
    "Actions: list (show all files), read (read a file), write (create/overwrite a file), append (add to a file).",
  parameters: [
    {
      name: "action",
      type: "string",
      required: true,
      description: '"list", "read", "write", or "append"',
    },
    {
      name: "filename",
      type: "string",
      required: false,
      description:
        'File name, e.g. "2026-03-11.md". Required for read/write/append.',
    },
    {
      name: "content",
      type: "string",
      required: false,
      description: "Content to write or append. Required for write/append.",
    },
  ],
  async execute(params, context) {
    const action = params.action as string;

    ensureMemoryDir();

    switch (action) {
      case "list": {
        const files = readdirSync(MEMORY_DIR)
          .filter((f) => f.endsWith(".md"))
          .sort();
        if (files.length === 0) return "No memory files found.";
        return `Memory files (${files.length}):\n${files.map((f) => `- ${f}`).join("\n")}`;
      }

      case "read": {
        if (!params.filename) throw new Error("filename is required for read");
        const fp = safePath(params.filename);
        if (!existsSync(fp)) return `File not found: ${params.filename}`;
        const text = readFileSync(fp, "utf-8");
        return text || "(empty file)";
      }

      case "write": {
        if (!params.filename) throw new Error("filename is required for write");
        if (params.content == null)
          throw new Error("content is required for write");
        const fp = safePath(params.filename);
        writeFileSync(fp, params.content, "utf-8");
        context.log.info(
          `[memory_edit] wrote ${params.filename} (${params.content.length} chars)`,
        );
        return `Written: ${params.filename} (${params.content.length} chars)`;
      }

      case "append": {
        if (!params.filename)
          throw new Error("filename is required for append");
        if (params.content == null)
          throw new Error("content is required for append");
        const fp = safePath(params.filename);
        const existing = existsSync(fp) ? readFileSync(fp, "utf-8") : "";
        const newContent = existing
          ? existing.trimEnd() + "\n\n" + params.content
          : params.content;
        writeFileSync(fp, newContent, "utf-8");
        context.log.info(
          `[memory_edit] appended to ${params.filename} (+${params.content.length} chars)`,
        );
        return `Appended to: ${params.filename} (now ${newContent.length} chars total)`;
      }

      default:
        throw new Error(
          `Unknown action: "${action}". Use list, read, write, or append.`,
        );
    }
  },
};

export default tool;

/**
 * generate-audio — Calls OpenAI TTS API to generate speech audio from text.
 *
 * Env vars:
 *   TTS_API_KEY  — API key (falls back to IMAGE_API_KEY, then OPENAI_API_KEY)
 *   TTS_BASE_URL — Base URL (falls back to IMAGE_BASE_URL, OPENAI_BASE_URL, then https://api.openai.com)
 *   TTS_MODEL    — Model name (default: tts-1)
 *
 * Returns a local URL that the device can download/play.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ServerToolDef } from "./types.js";

const GENERATED_DIR = join(tmpdir(), "pinclaw-generated");

function ensureDir(): void {
  if (!existsSync(GENERATED_DIR)) {
    mkdirSync(GENERATED_DIR, { recursive: true });
  }
}

/**
 * Upload a local audio file to the cloud API via relay token.
 * Returns the URL on success, or null if relay is not configured or upload fails.
 */
async function tryCloudUpload(
  filePath: string,
  mimeType: string,
  log: { info: (...args: any[]) => void; warn: (...args: any[]) => void },
): Promise<string | null> {
  const relayToken = process.env.PINCLAW_RELAY_TOKEN;
  if (!relayToken) return null;

  const relayUrl = (process.env.PINCLAW_RELAY_URL || "wss://api.pinclaw.ai")
    .replace("wss://", "https://")
    .replace("ws://", "http://");

  try {
    const rawData = readFileSync(filePath);
    const data = rawData.toString("base64");
    const filename = filePath.split("/").pop() || "audio.mp3";

    log.info(
      `[generate_audio] Uploading ${(rawData.length / 1024).toFixed(0)}KB to cloud...`,
    );

    const resp = await fetch(`${relayUrl}/api/v1/relay/media-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relayToken, data, mimeType, filename }),
      signal: AbortSignal.timeout(60_000),
    });

    if (resp.ok) {
      const result = (await resp.json()) as {
        url: string;
        size: number;
      };
      log.info(
        `[generate_audio] Cloud upload success (${(result.size / 1024).toFixed(0)}KB): ${result.url}`,
      );
      return result.url;
    }

    const errText = await resp.text();
    log.warn(
      `[generate_audio] Cloud upload failed (${resp.status}): ${errText}`,
    );
  } catch (err: any) {
    log.warn(`[generate_audio] Cloud upload error: ${err.message}`);
  }
  return null;
}

const tool: ServerToolDef = {
  name: "generate_audio",
  description:
    "Generate speech audio from text using OpenAI TTS. " +
    "Returns a URL to the audio file. " +
    "Use this when the user asks to generate audio, speech, narration, or voice output for specific text.",
  parameters: [
    {
      name: "text",
      type: "string",
      required: true,
      description: "The text to convert to speech",
    },
    {
      name: "voice",
      type: "string",
      required: false,
      description:
        '"alloy" (default), "echo", "fable", "onyx", "nova", or "shimmer"',
    },
    {
      name: "speed",
      type: "number",
      required: false,
      description: "Speed from 0.25 to 4.0 (default 1.0)",
    },
  ],
  async execute(params, context) {
    const apiKey =
      process.env.TTS_API_KEY ||
      process.env.IMAGE_API_KEY ||
      process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "TTS_API_KEY, IMAGE_API_KEY, or OPENAI_API_KEY not set. Add it to your environment to enable audio generation.",
      );
    }

    const text = params.text as string;
    if (!text) throw new Error("text is required");

    const voice = (params.voice as string) || "alloy";
    const speed = (params.speed as number) || 1.0;
    const baseUrl = (
      process.env.TTS_BASE_URL ||
      process.env.IMAGE_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com"
    ).replace(/\/+$/, "");
    const model = process.env.TTS_MODEL || "tts-1";

    context.log.info(
      `[generate_audio] Generating audio: "${text.slice(0, 80)}..." (voice: ${voice}, speed: ${speed})`,
    );

    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        speed,
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errBody = await response.text();
      context.log.error(
        `[generate_audio] API error: ${response.status} ${errBody}`,
      );
      throw new Error(
        `Audio generation failed (${response.status}): ${errBody}`,
      );
    }

    ensureDir();
    const filename = `${randomUUID()}.mp3`;
    const filePath = join(GENERATED_DIR, filename);
    const buf = Buffer.from(await response.arrayBuffer());
    writeFileSync(filePath, buf);

    const sizeMB = (buf.length / 1024 / 1024).toFixed(2);
    context.log.info(
      `[generate_audio] Saved audio: ${filePath} (${sizeMB} MB)`,
    );

    // Try cloud upload for remote accessibility, fall back to local URL
    const cloudUrl = await tryCloudUpload(filePath, "audio/mpeg", context.log);
    const audioUrl = cloudUrl || `/media/generated/${filename}`;

    return `Audio generated successfully.\nFile: ${filename}\nSize: ${sizeMB} MB\nURL: ${audioUrl}\n\nThe audio file has been generated and is available for download. Tell the user the audio was generated (voice: ${voice}, ${text.length} chars).\n\n[Audio: ${filename}](${audioUrl})`;
  },
};

export default tool;

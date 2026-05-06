/**
 * generate-image — Generates images via AI APIs.
 *
 * Supports three modes:
 *   1. OpenAI Images API (dall-e-3, gpt-image-1) — /v1/images/generations
 *   2. Native Gemini API (gemini-*-image) — generateContent with responseModalities
 *   3. OpenAI-compat chat completions (other models) — /v1/chat/completions
 *
 * Env vars:
 *   IMAGE_API_KEY  — API key (falls back to OPENAI_API_KEY)
 *   IMAGE_BASE_URL — Base URL (falls back to OPENAI_BASE_URL, then https://api.openai.com)
 *   IMAGE_MODEL    — Model name (default: gemini-2.5-flash-image)
 *
 * When running in relay mode (PINCLAW_RELAY_TOKEN is set), images are uploaded
 * to the cloud API so they're accessible to the iOS app remotely.
 * Falls back to local URLs if cloud upload fails.
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
 * Upload a local image to the cloud API via relay token.
 * The cloud server compresses images (max 1280px, JPEG q80) and stores both
 * compressed (7d) and original (72h) versions, like WeChat.
 *
 * Returns the compressed URL on success, or null if relay is not configured or upload fails.
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
    const filename = filePath.split("/").pop() || "image.png";

    log.info(
      `[generate_image] Uploading ${(rawData.length / 1024).toFixed(0)}KB to cloud (server will compress)...`,
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
        originalUrl?: string;
        size: number;
        originalSize?: number;
      };
      const ratio = result.originalSize
        ? `${(result.originalSize / 1024).toFixed(0)}KB → ${(result.size / 1024).toFixed(0)}KB`
        : `${(result.size / 1024).toFixed(0)}KB`;
      log.info(
        `[generate_image] Cloud upload success (${ratio}): ${result.url}`,
      );
      return result.url;
    }

    const errText = await resp.text();
    log.warn(
      `[generate_image] Cloud upload failed (${resp.status}): ${errText}`,
    );
  } catch (err: any) {
    log.warn(`[generate_image] Cloud upload error: ${err.message}`);
  }
  return null;
}

/**
 * Convert a local image file to a data URI.
 * Used as fallback when cloud upload fails — data URIs are self-contained
 * and can be rendered directly by the iOS app (no server round-trip).
 */
function toDataUri(filePath: string, mimeType: string): string {
  const data = readFileSync(filePath);
  const sizeKB = (data.length / 1024).toFixed(0);
  // Warn if the data URI will be very large (> 1.5 MB raw → ~2 MB base64)
  if (data.length > 1_500_000) {
    console.warn(
      `[generate_image] Large data URI fallback: ${sizeKB}KB — consider compressing`,
    );
  }
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

/** Extract base64 image data from a data URI (data:image/png;base64,...) */
function parseDataUri(uri: string): { ext: string; data: Buffer } | null {
  const match = uri.match(/^data:image\/(\w+);base64,(.+)$/s);
  if (!match) return null;
  return {
    ext: match[1] === "jpeg" ? "jpg" : match[1],
    data: Buffer.from(match[2], "base64"),
  };
}

/** Check if model should use native Gemini generateContent API. */
function useNativeGemini(model: string, baseUrl: string): boolean {
  return (
    baseUrl.includes("generativelanguage.googleapis.com") &&
    model.toLowerCase().includes("gemini")
  );
}

const tool: ServerToolDef = {
  name: "generate_image",
  description:
    "Generate an image from a text prompt using AI. " +
    "Returns the image URL that can be displayed to the user via markdown. " +
    "Use this when the user asks you to create, draw, or generate an image/picture/illustration.",
  parameters: [
    {
      name: "prompt",
      type: "string",
      required: true,
      description: "Detailed English description of the image to generate",
    },
    {
      name: "size",
      type: "string",
      required: false,
      description:
        '"1024x1024" (default), "1792x1024" (landscape), or "1024x1792" (portrait)',
    },
  ],
  async execute(params, context) {
    const apiKey = process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "IMAGE_API_KEY or OPENAI_API_KEY not set. Add it to your environment to enable image generation.",
      );
    }

    const prompt = params.prompt as string;
    if (!prompt) throw new Error("prompt is required");

    const size = (params.size as string) || "1024x1024";
    const baseUrl = (
      process.env.IMAGE_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com"
    ).replace(/\/+$/, "");
    const model = process.env.IMAGE_MODEL || "gemini-2.5-flash-image";
    const isNativeGemini = useNativeGemini(model, baseUrl);

    context.log.info(
      `[generate_image] model=${model}, mode=${isNativeGemini ? "gemini-native" : "openai"}, prompt="${prompt.slice(0, 80)}..."`,
    );

    ensureDir();

    if (isNativeGemini) {
      // ── Native Gemini API: generateContent with responseModalities ──
      // The OpenAI-compat endpoint does NOT support image output for Gemini models.
      const geminiBaseUrl = baseUrl.replace(/\/openai\/?$/, "");
      const url = `${geminiBaseUrl}/models/${model}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Generate an image: ${prompt}. Only output the image, no text explanation.`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });

      if (!response.ok) {
        const errBody = await response.text();
        context.log.error(
          `[generate_image] Gemini API error: ${response.status} ${errBody}`,
        );
        throw new Error(
          `Image generation failed (${response.status}): ${errBody}`,
        );
      }

      const rawBody = await response.text();
      let result: any;
      try {
        result = JSON.parse(rawBody);
      } catch {
        context.log.error(
          `[generate_image] JSON parse failed, body length: ${rawBody.length}`,
        );
        throw new Error("Failed to parse Gemini API response");
      }

      // Extract image from Gemini response parts
      const parts: any[] = result.candidates?.[0]?.content?.parts ?? [];
      let imageUrl: string | undefined;

      for (const part of parts) {
        if (part.inlineData) {
          const mime: string = part.inlineData.mimeType ?? "image/png";
          const ext =
            mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
          const data = Buffer.from(part.inlineData.data, "base64");
          const filename = `${randomUUID()}.${ext}`;
          const filePath = join(GENERATED_DIR, filename);
          writeFileSync(filePath, data);
          context.log.info(
            `[generate_image] Saved Gemini image: ${filename} (${(data.length / 1024).toFixed(0)} KB)`,
          );
          // Try cloud upload for remote accessibility, fall back to data URI
          imageUrl =
            (await tryCloudUpload(filePath, mime, context.log)) ??
            toDataUri(filePath, mime);
          break;
        }
      }

      if (!imageUrl) throw new Error("No image data in Gemini response");

      context.log.info(`[generate_image] Success: ${imageUrl}`);
      return `Image generated successfully.\nURL: ${imageUrl}\n\nTo display this image to the user, include it in your response using markdown: ![Generated Image](${imageUrl})`;
    }

    // ── Standard OpenAI Images API (dall-e-3, gpt-image-1, etc.) ──
    const response = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errBody = await response.text();
      context.log.error(
        `[generate_image] API error: ${response.status} ${errBody}`,
      );
      throw new Error(
        `Image generation failed (${response.status}): ${errBody}`,
      );
    }

    const result = (await response.json()) as {
      data: Array<{ url?: string; revised_prompt?: string; b64_json?: string }>;
    };

    const imageData = result.data?.[0];
    if (!imageData) throw new Error("No image data returned from API");

    let imageUrl = imageData.url;

    // If we got a URL, download and save locally
    if (imageUrl) {
      try {
        const filename = `${randomUUID()}.png`;
        const filePath = join(GENERATED_DIR, filename);
        const imgRes = await fetch(imageUrl, {
          signal: AbortSignal.timeout(30_000),
        });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          writeFileSync(filePath, buf);
          // Try cloud upload, fall back to data URI
          imageUrl =
            (await tryCloudUpload(filePath, "image/png", context.log)) ??
            toDataUri(filePath, "image/png");
          context.log.info(`[generate_image] Saved from URL: ${filePath}`);
        }
      } catch (err: any) {
        context.log.warn(
          `[generate_image] Failed to save from URL: ${err.message}`,
        );
        // Keep the original URL as fallback
      }
    }

    // If API returned base64, save locally
    if (!imageUrl && imageData.b64_json) {
      const filename = `${randomUUID()}.png`;
      const filePath = join(GENERATED_DIR, filename);
      writeFileSync(filePath, Buffer.from(imageData.b64_json, "base64"));
      // Try cloud upload, fall back to data URI
      imageUrl =
        (await tryCloudUpload(filePath, "image/png", context.log)) ??
        toDataUri(filePath, "image/png");
      context.log.info(`[generate_image] Saved base64: ${filePath}`);
    }

    if (!imageUrl) throw new Error("Failed to obtain image");

    const revisedPrompt = imageData.revised_prompt
      ? `\nRevised prompt: ${imageData.revised_prompt}`
      : "";

    context.log.info(`[generate_image] Success: ${imageUrl}`);
    return `Image generated successfully.\nURL: ${imageUrl}${revisedPrompt}\n\nTo display this image to the user, include it in your response using markdown: ![Generated Image](${imageUrl})`;
  },
};

export default tool;

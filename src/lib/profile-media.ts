import { createAIProviderForName, type ImageInput } from "@/lib/ai";
import {
  type AIProviderName,
  getActiveImageProviderChain,
  getActiveVoiceProviderChain,
} from "@/lib/ai/provider-catalog";
import { normalizeAudioForBrowserPlayback } from "@/lib/audio-format";
import { env } from "@/lib/env";

import type {
  VoiceSynthesisProvider,
  VoiceSynthesisResult,
} from "@/lib/integrations/types";

/**
 * Profile media (avatar image + voice intro) is driven by SystemConfig so
 * operators can flip the chain from `/admin/ai-provider` without a redeploy.
 * Defaults are Qwen → Gemini (see `IMAGE_FALLBACK_ORDER` /
 * `VOICE_FALLBACK_ORDER` in provider-catalog.ts).
 */

function isGeminiConfigured(): boolean {
  return Boolean(env.GOOGLE_CLOUD_PROJECT?.trim());
}

function isImageProviderConfigured(name: AIProviderName): boolean {
  switch (name) {
    case "gemini":
      return isGeminiConfigured();
    case "qwen":
      return Boolean(env.DASHSCOPE_API_KEY?.trim());
    case "openai":
      return Boolean(env.OPENAI_API_KEY?.trim());
    case "zai":
      return Boolean(env.ZAI_API_KEY?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim());
    default:
      return false;
  }
}

async function generateProfileImageWithGemini(
  data: ImageInput,
): Promise<string | null> {
  const { GeminiProvider } = await import("@/lib/ai/gemini");
  return new GeminiProvider().generateProfileImage(data);
}

async function normalizeProfileImage(image: string): Promise<string | null> {
  const normalized = image.trim();
  if (!normalized) return null;
  if (normalized.startsWith("data:image/")) return normalized;
  if (!/^https?:\/\//i.test(normalized)) {
    console.warn("[profile-media] Unsupported profile image format", normalized.slice(0, 80));
    return null;
  }

  const response = await fetch(normalized);
  if (!response.ok) {
    throw new Error(
      `Failed to download generated profile image (${response.status}) from provider URL.`,
    );
  }

  const contentType = response.headers.get("content-type")?.trim() || "image/png";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Generated profile image URL returned unexpected content type "${contentType}".`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new Error("Generated profile image URL returned an empty response body.");
  }

  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function generateProfileImageWithProvider(
  providerName: AIProviderName,
  data: ImageInput,
): Promise<string | null> {
  const image = providerName === "gemini"
    ? await generateProfileImageWithGemini(data)
    : await createAIProviderForName(providerName).generateProfileImage(data);
  if (!image) return null;
  return normalizeProfileImage(image);
}

export async function generateProfileImageResilient(
  data: ImageInput,
): Promise<string | null> {
  const configured = await getActiveImageProviderChain();
  const order = configured.filter(isImageProviderConfigured);
  if (order.length === 0) {
    throw new Error(
      `No image provider in the configured chain (${configured.join(", ") || "empty"}) has credentials. Set DASHSCOPE_API_KEY (Qwen) or Vertex Gemini credentials (GOOGLE_CLOUD_PROJECT + GOOGLE_SERVICE_ACCOUNT_KEY), or update IMAGE_PROVIDER_CHAIN in /admin/providers.`,
    );
  }

  const attempts: string[] = [];
  for (const providerName of order) {
    try {
      const image = await generateProfileImageWithProvider(providerName, data);
      if (image) return image;
      attempts.push(`"${providerName}" returned no image data`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[profile-media] Provider "${providerName}" failed`, error);
      attempts.push(`"${providerName}" failed: ${message}`);
    }
  }

  throw new Error(
    `No configured profile image provider produced an image. Tried ${order.join(", ")}. ${attempts.join("; ")}`,
  );
}

/**
 * Profile-intro voice synthesis chain — read at request time from
 * SystemConfig `VOICE_PROVIDER_CHAIN`. Defaults to qwen-tts → gemini-tts.
 * Providers without credentials are filtered out automatically.
 */
export async function getProfileIntroVoiceSynthesisProviders(): Promise<VoiceSynthesisProvider[]> {
  const chain = await getActiveVoiceProviderChain();
  const providers: VoiceSynthesisProvider[] = [];

  for (const name of chain) {
    if (name === "qwen-tts") {
      if (!env.DASHSCOPE_API_KEY?.trim()) continue;
      const { QwenTTSProvider } = await import("@/lib/integrations/qwen-tts");
      providers.push(new QwenTTSProvider());
    } else if (name === "gemini-tts") {
      if (!isGeminiConfigured()) continue;
      const { GeminiTtsProvider } = await import("@/lib/integrations/gemini-tts");
      providers.push(new GeminiTtsProvider());
    }
  }

  return providers;
}

export function buildProfileAudioDataUrl(
  result: VoiceSynthesisResult,
): string {
  const normalizedBase64 = result.audioBase64.replace(/\s+/g, "");
  const buffer = Buffer.from(normalizedBase64, "base64");
  if (buffer.length === 0) {
    throw new Error("Voice synthesis returned empty audio.");
  }
  const normalized = normalizeAudioForBrowserPlayback({
    buffer,
    declaredMime: result.format?.includes("/") ? result.format : null,
    declaredFormat: result.format,
  });
  return `data:${normalized.mimeType};base64,${normalized.buffer.toString("base64")}`;
}

import { createAIProviderForName, type ImageInput } from "@/lib/ai";
import { normalizeAudioForBrowserPlayback } from "@/lib/audio-format";
import { env } from "@/lib/env";

import type {
  VoiceSynthesisProvider,
  VoiceSynthesisResult,
} from "@/lib/integrations/types";

/**
 * Profile media (avatar image + voice intro) uses an explicit Qwen → Gemini
 * chain regardless of `AI_PROVIDER`. Qwen first because DashScope's image and
 * TTS endpoints sit in `ap-southeast-1` (and inside the GFW for CN traffic);
 * Gemini is the fallback for capacity/availability.
 */
const PROFILE_IMAGE_ORDER = ["qwen", "gemini"] as const;
type ProfileImageProvider = (typeof PROFILE_IMAGE_ORDER)[number];

function isGeminiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim());
}

function isProfileImageProviderConfigured(name: ProfileImageProvider): boolean {
  if (name === "gemini") return isGeminiConfigured();
  if (name === "qwen") return Boolean(env.DASHSCOPE_API_KEY?.trim());
  return false;
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
  providerName: ProfileImageProvider,
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
  const order = PROFILE_IMAGE_ORDER.filter(isProfileImageProviderConfigured);
  if (order.length === 0) {
    throw new Error(
      "No profile image provider configured. Set DASHSCOPE_API_KEY (Qwen) or GEMINI_API_KEY.",
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
 * Profile-intro voice synthesis chain: Qwen TTS → Gemini TTS.
 * Each provider is included only when its credentials are present, so the
 * order returned is also the order to attempt.
 */
export async function getProfileIntroVoiceSynthesisProviders(): Promise<VoiceSynthesisProvider[]> {
  const providers: VoiceSynthesisProvider[] = [];

  if (env.DASHSCOPE_API_KEY?.trim()) {
    const { QwenTTSProvider } = await import("@/lib/integrations/qwen-tts");
    providers.push(new QwenTTSProvider());
  }

  if (isGeminiConfigured()) {
    const { GeminiTtsProvider } = await import("@/lib/integrations/gemini-tts");
    providers.push(new GeminiTtsProvider());
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

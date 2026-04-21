import { createAIProviderForName, type ImageInput } from "@/lib/ai";
import { normalizeAudioForBrowserPlayback } from "@/lib/audio-format";
import { IMAGE_FALLBACK_ORDER } from "@/lib/ai/provider-catalog";
import { env } from "@/lib/env";
import { hasGoogleServiceAccountConfig } from "@/lib/google-access-token";
import { getVoiceSynthesis } from "@/lib/integrations/config";
import { isAlibabaCloudVendorDemoDeployment } from "@/lib/vendor-ai-stack-site";

import type {
  VoiceSynthesisProvider,
  VoiceSynthesisResult,
} from "@/lib/integrations/types";

const IMAGE_UNSUPPORTED_AI_PROVIDERS = new Set(["byteplus", "volcengine"]);

function currentAiProvider(): string {
  return (env.AI_PROVIDER || "qwen").trim().toLowerCase();
}

/**
 * Alibaba showcase hosts should not inherit a mistaken non-Qwen `AI_PROVIDER`
 * from another deployment.
 * Profile images use this primary provider before Gemini fallback rules.
 */
function primaryProviderForProfileImage(): string {
  if (isAlibabaCloudVendorDemoDeployment()) return "qwen";
  return currentAiProvider();
}

function isGeminiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim());
}

async function generateProfileImageWithGemini(
  data: ImageInput,
): Promise<string | null> {
  const { GeminiProvider } = await import("@/lib/ai/gemini");
  return new GeminiProvider().generateProfileImage(data);
}

function isProviderConfiguredForProfileImage(providerName: string): boolean {
  switch (providerName) {
    case "gemini":
      return isGeminiConfigured();
    case "qwen":
      return Boolean(env.DASHSCOPE_API_KEY?.trim());
    case "openai":
      return Boolean(env.OPENAI_API_KEY?.trim());
    case "zai":
      return Boolean(
        env.ZAI_API_KEY?.trim() ||
          (env.GOOGLE_CLOUD_PROJECT?.trim() && hasGoogleServiceAccountConfig()),
      );
    case "dedalus":
      return Boolean(env.DEDALUS_API_KEY?.trim());
    default:
      return false;
  }
}

function profileImageProviderOrder(primaryProvider: string): string[] {
  const ordered = [primaryProvider, ...IMAGE_FALLBACK_ORDER];
  return ordered.filter(
    (providerName, index) =>
      ordered.indexOf(providerName) === index &&
      (providerName === primaryProvider ||
        isProviderConfiguredForProfileImage(providerName)),
  );
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
  providerName: string,
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
  const primaryProvider = primaryProviderForProfileImage();
  const providerOrder = profileImageProviderOrder(primaryProvider);
  const attempts: string[] = [];

  for (const providerName of providerOrder) {
    if (
      providerName !== primaryProvider &&
      IMAGE_UNSUPPORTED_AI_PROVIDERS.has(providerName)
    ) {
      continue;
    }

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

  if (attempts.length > 0) {
    throw new Error(
      `No configured profile image provider produced an image. Tried ${providerOrder.join(", ")}. ${attempts.join("; ")}`,
    );
  }

  return null;
}

async function createGeminiProfileIntroVoiceSynthesis(): Promise<VoiceSynthesisProvider | null> {
  if (!isGeminiConfigured()) return null;
  const { GeminiTtsProvider } = await import("@/lib/integrations/gemini-tts");
  return new GeminiTtsProvider();
}

export async function getProfileIntroVoiceSynthesisProviders(): Promise<VoiceSynthesisProvider[]> {
  const providers: VoiceSynthesisProvider[] = [];

  const fallback = await getVoiceSynthesis();
  if (fallback) {
    providers.push(fallback);
  }

  const gemini = await createGeminiProfileIntroVoiceSynthesis().catch(() => null);
  if (gemini) {
    const duplicate = providers.some(
      (provider) => provider.constructor === gemini.constructor,
    );
    if (!duplicate) providers.push(gemini);
  }

  return providers;
}

function detectAudioMime(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45
  ) {
    return "audio/wav";
  }

  if (
    (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x4f &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  ) {
    return "audio/ogg";
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return "audio/webm";
  }

  if (
    buffer.length >= 8 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return "audio/mp4";
  }

  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) {
    return "audio/aac";
  }

  return null;
}

function mimeFromDeclaredFormat(format?: string | null): string {
  const normalized = format?.trim().toLowerCase();
  if (normalized === "mp3" || normalized === "mpeg") return "audio/mpeg";
  if (normalized === "ogg" || normalized === "opus") return "audio/ogg";
  if (normalized === "mp4" || normalized === "m4a") return "audio/mp4";
  if (normalized === "webm") return "audio/webm";
  if (normalized === "aac") return "audio/aac";
  return "audio/wav";
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

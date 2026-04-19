import { generateProfileImage, type ImageInput } from "@/lib/ai";
import {
  normalizeAudioForBrowserPlayback,
} from "@/lib/audio-format";
import { env } from "@/lib/env";
import { getVoiceSynthesis } from "@/lib/integrations/config";

import type {
  VoiceSynthesisProvider,
  VoiceSynthesisResult,
} from "@/lib/integrations/types";

const IMAGE_UNSUPPORTED_AI_PROVIDERS = new Set(["byteplus", "volcengine"]);

function currentAiProvider(): string {
  return (env.AI_PROVIDER || "qwen").trim().toLowerCase();
}

function isQwenConfigured(): boolean {
  return Boolean(env.DASHSCOPE_API_KEY?.trim());
}

function isGeminiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim());
}

async function generateProfileImageWithQwen(
  data: ImageInput,
): Promise<string | null> {
  const { QwenProvider } = await import("@/lib/ai/qwen");
  return new QwenProvider().generateProfileImage(data);
}

async function generateProfileImageWithGemini(
  data: ImageInput,
): Promise<string | null> {
  const { GeminiProvider } = await import("@/lib/ai/gemini");
  return new GeminiProvider().generateProfileImage(data);
}

export async function generateProfileImageResilient(
  data: ImageInput,
): Promise<string | null> {
  const aiProvider = currentAiProvider();
  let lastError: unknown = null;

  // Profile avatars should prefer DashScope/Qwen when available because the
  // Gemini image path has proven less reliable in production for this flow.
  if (isQwenConfigured()) {
    try {
      const image = await generateProfileImageWithQwen(data);
      if (image) return image;
      lastError = new Error("Qwen image generation returned no image data.");
    } catch (error) {
      lastError = error;
    }
  }

  if (isGeminiConfigured() && IMAGE_UNSUPPORTED_AI_PROVIDERS.has(aiProvider)) {
    const image = await generateProfileImageWithGemini(data);
    if (image) return image;
    throw new Error("Gemini image generation returned no image data.");
  }

  if (aiProvider !== "qwen") {
    try {
      const image = await generateProfileImage(data);
      if (image) return image;
      lastError = new Error(`AI_PROVIDER "${aiProvider}" returned no profile image.`);
    } catch (error) {
      lastError = error;
    }
  }

  if (isGeminiConfigured() && aiProvider !== "gemini") {
    try {
      const image = await generateProfileImageWithGemini(data);
      if (image) return image;
      lastError = new Error("Gemini image generation returned no image data.");
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  if (lastError) throw new Error(String(lastError));
  return null;
}

async function createGeminiProfileIntroVoiceSynthesis(): Promise<VoiceSynthesisProvider | null> {
  if (!isGeminiConfigured()) return null;
  const { GeminiTtsProvider } = await import("@/lib/integrations/gemini-tts");
  return new GeminiTtsProvider();
}

export async function getProfileIntroVoiceSynthesisProviders(): Promise<VoiceSynthesisProvider[]> {
  const providers: VoiceSynthesisProvider[] = [];

  const gemini = await createGeminiProfileIntroVoiceSynthesis().catch(() => null);
  if (gemini) {
    providers.push(gemini);
  }

  const fallback = await getVoiceSynthesis();
  if (fallback) {
    const duplicate = providers.some(
      (provider) => provider.constructor === fallback.constructor,
    );
    if (!duplicate) {
      providers.push(fallback);
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
    declaredFormat: result.format,
    fallbackPcmSampleRateHz: 24_000,
  });
  return `data:${normalized.mimeType};base64,${normalized.buffer.toString("base64")}`;
}

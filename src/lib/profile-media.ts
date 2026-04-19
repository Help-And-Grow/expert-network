import { generateProfileImage, type ImageInput } from "@/lib/ai";
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

function isGeminiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim());
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

  if (isGeminiConfigured() && IMAGE_UNSUPPORTED_AI_PROVIDERS.has(aiProvider)) {
    const image = await generateProfileImageWithGemini(data);
    if (image) return image;
    throw new Error("Gemini image generation returned no image data.");
  }

  try {
    const image = await generateProfileImage(data);
    if (image) return image;
    lastError = new Error(`AI_PROVIDER "${aiProvider}" returned no profile image.`);
  } catch (error) {
    lastError = error;
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
  const mime = detectAudioMime(buffer) || mimeFromDeclaredFormat(result.format);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

import { Modality } from "@google/genai";

import { createGeminiImageClient } from "@/lib/ai/gemini-client";
import { isFemaleExpertGender } from "@/lib/expert-voice-gender";
import { env } from "@/lib/env";

import type {
  VoiceSynthesisProvider,
  VoiceSynthesisInput,
  VoiceSynthesisResult,
} from "./types";

/** @see https://ai.google.dev/gemini-api/docs/speech-generation */
const DEFAULT_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

function getTtsModel(): string {
  return env.GEMINI_TTS_MODEL?.trim() || DEFAULT_GEMINI_TTS_MODEL;
}

/** Map Qwen/other built-in names when the same expert profile is used across providers. */
const QWENISH_TO_GEMINI: Record<string, string> = {
  Cherry: "Kore",
  Jennifer: "Kore",
  Katerina: "Kore",
  Jada: "Kore",
  Sunny: "Kore",
  Kiki: "Kore",
  Ethan: "Charon",
  Ryan: "Charon",
  Elias: "Charon",
  Dylan: "Charon",
  Marcus: "Charon",
  Roy: "Charon",
  Peter: "Charon",
  Rocky: "Charon",
  Eric: "Charon",
  Li: "Charon",
  Nofish: "Charon",
};

/** Gemini SDK may return base64 as string or raw bytes. */
function inlineAudioToBase64(data: unknown): string | null {
  if (typeof data === "string") {
    const s = data.replace(/\s+/g, "");
    return s.length ? s : null;
  }
  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString("base64");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("base64");
  }
  return null;
}

function resolveVoiceName(voiceId?: string | null): string {
  const fromEnvFemale = env.GEMINI_TTS_VOICE_FEMALE?.trim();
  const fromEnvMale = env.GEMINI_TTS_VOICE_MALE?.trim();
  const v = voiceId?.trim();
  if (!v || v === "default" || v.includes("-voice")) {
    return fromEnvMale || "Charon";
  }
  const mapped = QWENISH_TO_GEMINI[v];
  if (mapped) return mapped === "Kore" ? (fromEnvFemale || "Kore") : (fromEnvMale || "Charon");
  return v;
}

export function defaultGeminiTtsVoiceId(gender?: string | null): string {
  const f = env.GEMINI_TTS_VOICE_FEMALE?.trim() || "Kore";
  const m = env.GEMINI_TTS_VOICE_MALE?.trim() || "Charon";
  return isFemaleExpertGender(gender) ? f : m;
}

/**
 * Gemini native TTS (Vertex AI or AI Studio) via @google/genai.
 * Uses the same Vertex region strategy as profile image generation (`createGeminiImageClient`).
 */
export class GeminiTtsProvider implements VoiceSynthesisProvider {
  private client = createGeminiImageClient();

  getDefaultVoiceId(gender?: string | null): string | undefined {
    return defaultGeminiTtsVoiceId(gender);
  }

  async synthesize(input: VoiceSynthesisInput): Promise<VoiceSynthesisResult> {
    const project = env.GOOGLE_CLOUD_PROJECT?.trim();
    const apiKey = env.GEMINI_API_KEY?.trim();
    if (!project && !apiKey) {
      throw new Error(
        "Gemini TTS requires GOOGLE_CLOUD_PROJECT (Vertex) or GEMINI_API_KEY (AI Studio)",
      );
    }

    const voiceName = resolveVoiceName(input.voiceId);

    try {
      const response = await this.client.models.generateContent({
        model: getTtsModel(),
        contents: input.text,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      let parts = response.candidates?.[0]?.content?.parts;
      if (!parts?.length) {
        const retry = await this.client.models.generateContent({
          model: getTtsModel(),
          contents: input.text,
          config: {
            responseModalities: [Modality.TEXT, Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        });
        parts = retry.candidates?.[0]?.content?.parts;
      }

      if (!parts?.length) {
        const c = response.candidates?.[0];
        console.error("[Gemini TTS] No audio parts", {
          finishReason: c?.finishReason,
          finishMessage: c?.finishMessage,
        });
        throw new Error("Gemini TTS returned no audio. Check model/region (try GEMINI_IMAGE_VERTEX_LOCATION=global) and billing.");
      }

      for (const part of parts) {
        const raw = part.inlineData?.data;
        const audioBase64 = inlineAudioToBase64(raw);
        if (!audioBase64) continue;
        const mime = (part.inlineData?.mimeType || "audio/wav").toLowerCase();
        const format = mime.includes("mpeg") || mime.includes("mp3")
          ? "mp3"
          : mime.includes("wav")
            ? "wav"
            : mime.includes("ogg")
              ? "ogg"
              : "wav";
        return { audioBase64, format };
      }

      throw new Error("Gemini TTS response had no inline audio data");
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Gemini TTS")) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Gemini TTS] synthesize failed:", msg);
      throw new Error(`Gemini TTS failed: ${msg.slice(0, 400)}`);
    }
  }
}

import { env } from "@/lib/env";
import type {
  VoiceSynthesisProvider,
  VoiceSynthesisInput,
  VoiceSynthesisResult,
} from "./types";

const DASHSCOPE_TTS_URL =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const DASHSCOPE_CLONE_URL =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/audio/tts/customization";

const TTS_MODEL = "qwen3-tts-flash";
const TTS_VC_MODEL = "qwen3-tts-vc-2026-01-22";
const CLONE_MODEL = "qwen-voice-enrollment";

const SYSTEM_VOICES = new Set([
  "Cherry", "Ethan", "Jennifer", "Katerina", "Jada", "Sunny", "Kiki",
  "Nofish", "Ryan", "Elias", "Dylan", "Li", "Marcus", "Roy", "Peter",
  "Rocky", "Eric",
]);

/**
 * Qwen3-TTS voice synthesis provider (DashScope).
 *
 * Uses DASHSCOPE_API_KEY (same key as LLM + image generation).
 *
 * Standard voices  → qwen3-tts-flash          (17 built-in voices)
 * Cloned voices    → qwen3-tts-vc-2026-01-22  (zero-shot voice cloning)
 */
export class QwenTTSProvider implements VoiceSynthesisProvider {
  private apiKey: string;

  constructor() {
    const key = env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY is not set");
    this.apiKey = key;
  }

  getDefaultVoiceId(gender?: string | null): string | undefined {
    return gender === "female" ? "Cherry" : "Ethan";
  }

  async synthesize(input: VoiceSynthesisInput): Promise<VoiceSynthesisResult> {
    const voice = input.voiceId || "Ethan";
    const isSystemVoice = SYSTEM_VOICES.has(voice);
    const model = isSystemVoice ? TTS_MODEL : TTS_VC_MODEL;

    const res = await fetch(DASHSCOPE_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: { text: input.text, voice, language_type: "Auto" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Qwen TTS failed (${res.status}): ${errText.slice(0, 500)}`
      );
    }

    const data = await res.json();
    const audioUrl: string | undefined = data?.output?.audio?.url;
    if (!audioUrl) {
      throw new Error(
        `Qwen TTS response missing audio URL: ${JSON.stringify(data).slice(0, 300)}`
      );
    }

    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      throw new Error(
        `Failed to download Qwen TTS audio (${audioRes.status})`
      );
    }

    const arrayBuf = await audioRes.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuf).toString("base64");

    return { audioBase64, format: "wav" };
  }

  async cloneVoice(
    title: string,
    audio: Buffer | Uint8Array
  ): Promise<string> {
    const base64Audio = Buffer.from(audio).toString("base64");
    const mimeType = detectAudioMime(audio) || "audio/wav";
    const dataUri = `data:${mimeType};base64,${base64Audio}`;

    const res = await fetch(DASHSCOPE_CLONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLONE_MODEL,
        input: {
          action: "create",
          target_model: TTS_VC_MODEL,
          preferred_name: title.slice(0, 50),
          audio: { data: dataUri },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Qwen voice clone failed (${res.status}): ${errText.slice(0, 500)}`
      );
    }

    const data = await res.json();
    const voiceId: string | undefined = data?.output?.voice;
    if (!voiceId) {
      throw new Error(
        `Qwen voice clone response missing voice ID: ${JSON.stringify(data).slice(0, 300)}`
      );
    }

    return voiceId;
  }
}

function detectAudioMime(data: Buffer | Uint8Array): string | null {
  if (data.length < 8) return null;
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46)
    return "audio/wav";
  if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33)
    return "audio/mpeg";
  if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)
    return "audio/mpeg";
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3)
    return "audio/webm";
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70)
    return "audio/mp4";
  return null;
}

/**
 * Integration feature flags and provider registry.
 *
 * Each integration can be enabled/disabled via environment variables.
 * Providers are lazily instantiated on first access.
 */

import type {
  VoiceSynthesisProvider,
  MemoryProvider,
  MeetingRecordingProvider,
} from "./types";

// ---------------------------------------------------------------------------
// Feature flags (server-side, read from env)
// ---------------------------------------------------------------------------

import { env } from "@/lib/env";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const aiProvider = (env.AI_PROVIDER || "qwen").trim().toLowerCase();
const geminiVoiceReady = Boolean(
  env.GOOGLE_CLOUD_PROJECT?.trim() || env.GEMINI_API_KEY?.trim(),
);
const hasFish = Boolean(env.FISH_AUDIO_API_KEY);
const hasDash = Boolean(env.DASHSCOPE_API_KEY);

/** Prefer Gemini TTS if available to avoid DashScope quota limits, then fallback to Qwen or Fish. */
let voiceSynthesisProvider: "fish-audio" | "qwen-tts" | "gemini-tts";
if (geminiVoiceReady) {
  voiceSynthesisProvider = "gemini-tts";
} else if (hasFish) {
  voiceSynthesisProvider = "fish-audio";
} else if (hasDash) {
  voiceSynthesisProvider = "qwen-tts";
} else {
  voiceSynthesisProvider = "qwen-tts"; // fallback to trigger missing key errors
}

const voiceSynthesisEnabled = hasFish || hasDash || geminiVoiceReady;

export const integrations = {
  voiceSynthesis: {
    enabled: voiceSynthesisEnabled,
    provider: voiceSynthesisProvider,
  },
  memory: {
    enabled: !!process.env.MEM9_SPACE_ID || !!process.env.MEM9_ENABLED,
    provider: "mem9" as const,
  },
  meetingRecording: {
    enabled: false,
    provider: null as string | null,
  },
} as const;

// ---------------------------------------------------------------------------
// Provider registry (lazy singletons)
// ---------------------------------------------------------------------------

let _voiceSynthesis: VoiceSynthesisProvider | null = null;
let _memory: MemoryProvider | null = null;
// eslint-disable-next-line prefer-const
let _meetingRecording: MeetingRecordingProvider | null = null;

export async function getVoiceSynthesis(): Promise<VoiceSynthesisProvider | null> {
  if (!integrations.voiceSynthesis.enabled) return null;
  if (!_voiceSynthesis) {
    if (integrations.voiceSynthesis.provider === "fish-audio") {
      const { FishAudioProvider } = await import("./fish-audio");
      _voiceSynthesis = new FishAudioProvider();
    } else if (integrations.voiceSynthesis.provider === "gemini-tts") {
      const { GeminiTtsProvider } = await import("./gemini-tts");
      _voiceSynthesis = new GeminiTtsProvider();
    } else {
      const { QwenTTSProvider } = await import("./qwen-tts");
      _voiceSynthesis = new QwenTTSProvider();
    }
  }
  return _voiceSynthesis;
}

export async function getMemory(): Promise<MemoryProvider | null> {
  if (!integrations.memory.enabled) return null;
  if (!_memory) {
    const { Mem9Provider } = await import("./mem9");
    _memory = new Mem9Provider();
  }
  return _memory;
}

export async function getMeetingRecording(): Promise<MeetingRecordingProvider | null> {
  if (!integrations.meetingRecording.enabled) return null;
  if (!_meetingRecording) {
    return null;
  }
  return _meetingRecording;
}

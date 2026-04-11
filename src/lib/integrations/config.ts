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

export const integrations = {
  voiceSynthesis: {
    enabled: !!process.env.FISH_AUDIO_API_KEY || !!process.env.DASHSCOPE_API_KEY,
    provider: process.env.FISH_AUDIO_API_KEY ? "fish-audio" : "qwen-tts",
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

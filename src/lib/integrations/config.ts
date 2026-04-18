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
import { isGoogleCloudVendorDemoDeployment } from "@/lib/vendor-ai-stack-site";

function readConfiguredKey(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

const dashscopeKey = readConfiguredKey(env.DASHSCOPE_API_KEY);
const byteplusKey = readConfiguredKey(env.BYTEPLUS_API_KEY);
const volcengineKey = readConfiguredKey(env.VOLCENGINE_API_KEY);

function getDashscopeKeyIssue(): string | null {
  if (dashscopeKey && byteplusKey && dashscopeKey === byteplusKey) {
    return "DASHSCOPE_API_KEY matches BYTEPLUS_API_KEY. BytePlus ModelArk keys only power the text model here; voice chat transcription and Qwen TTS still require a real DashScope key.";
  }
  if (dashscopeKey && volcengineKey && dashscopeKey === volcengineKey) {
    return "DASHSCOPE_API_KEY matches VOLCENGINE_API_KEY. Volcengine ModelArk keys do not work for DashScope ASR/TTS.";
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const aiProvider = (env.AI_PROVIDER || "qwen").trim().toLowerCase();
const geminiVoiceReady = Boolean(
  env.GOOGLE_CLOUD_PROJECT?.trim() || env.GEMINI_API_KEY?.trim(),
);
const hasFish = Boolean(env.FISH_AUDIO_API_KEY);
const hasDash = Boolean(dashscopeKey) && !getDashscopeKeyIssue();

/** Alibaba DashScope for speech I/O (vs Gemini TTS) — includes Google Cloud vendor demo with Gemini LLM. */
const voiceStackPrefersDashScope =
  aiProvider === "qwen" ||
  aiProvider === "byteplus" ||
  (isGoogleCloudVendorDemoDeployment() && aiProvider === "gemini");

/**
 * Select TTS provider respecting AI_PROVIDER first, then falling back by key availability.
 * - qwen  → always qwen-tts (DashScope)
 * - byteplus → qwen-tts (DashScope ASR/TTS) unless only Gemini/Fish keys present
 * - expert-network-googlecloud + gemini → qwen-tts when DashScope is configured (Gemini LLM only)
 * - gemini → gemini-tts if ready, else fish, else qwen
 * - others → gemini if ready, else fish, else qwen
 */
let voiceSynthesisProvider: "fish-audio" | "qwen-tts" | "gemini-tts";
if (voiceStackPrefersDashScope) {
  // These providers use DashScope for TTS; never auto-select Gemini TTS
  if (hasDash) {
    voiceSynthesisProvider = "qwen-tts";
  } else if (hasFish) {
    voiceSynthesisProvider = "fish-audio";
  } else if (geminiVoiceReady) {
    voiceSynthesisProvider = "gemini-tts";
  } else {
    voiceSynthesisProvider = "qwen-tts"; // will surface missing key error
  }
} else if (geminiVoiceReady) {
  voiceSynthesisProvider = "gemini-tts";
} else if (hasFish) {
  voiceSynthesisProvider = "fish-audio";
} else if (hasDash) {
  voiceSynthesisProvider = "qwen-tts";
} else {
  voiceSynthesisProvider = "qwen-tts"; // fallback to trigger missing key errors
}

const voiceSynthesisEnabled = hasFish || hasDash || geminiVoiceReady;

export function getVoiceTranscriptionConfigIssue(): string | null {
  const dashscopeIssue = getDashscopeKeyIssue();
  if (dashscopeIssue) return dashscopeIssue;
  if (!dashscopeKey) {
    if (aiProvider === "byteplus") {
      return "BytePlus voice input still requires DASHSCOPE_API_KEY for DashScope ASR. BYTEPLUS_API_KEY only powers the text reply.";
    }
    if (isGoogleCloudVendorDemoDeployment() && aiProvider === "gemini") {
      return "expert-network-googlecloud uses Gemini for LLM but DashScope (DASHSCOPE_API_KEY) for speech recognition.";
    }
    return "Voice input requires DASHSCOPE_API_KEY for DashScope ASR.";
  }
  return null;
}

export function getVoiceSynthesisConfigIssue(): string | null {
  if (voiceStackPrefersDashScope) {
    // These providers require DashScope for TTS
    const dashscopeIssue = getDashscopeKeyIssue();
    if (dashscopeIssue) return dashscopeIssue;
    if (hasDash) return null;
    if (hasFish) return null; // fish-audio fallback
    if (aiProvider === "byteplus") {
      return "BytePlus ModelArk powers the text reply only. Voice audio requires FISH_AUDIO_API_KEY or a real DASHSCOPE_API_KEY.";
    }
    return "Voice audio requires DASHSCOPE_API_KEY for Qwen TTS.";
  }
  if (geminiVoiceReady || hasFish) return null;
  const dashscopeIssue = getDashscopeKeyIssue();
  if (dashscopeIssue) return dashscopeIssue;
  if (hasDash) return null;
  return "Voice audio is not configured.";
}

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

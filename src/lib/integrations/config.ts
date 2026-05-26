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

function readConfiguredKey(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

const dashscopeKey = readConfiguredKey(env.DASHSCOPE_API_KEY);
const byteplusKey = readConfiguredKey(env.BYTEPLUS_API_KEY);
const volcengineKey = readConfiguredKey(env.VOLCENGINE_API_KEY);
const memoryBackend = (process.env.MEMORY_BACKEND || "").trim().toLowerCase();
const mem9Enabled = Boolean(
  readConfiguredKey(env.MEM9_ENABLED) ||
    readConfiguredKey(env.MEM9_API_KEY) ||
    readConfiguredKey(env.MEM9_SPACE_ID) ||
    memoryBackend === "mem9" ||
    memoryBackend === "hybrid",
);

function getDashscopeKeyIssue(): string | null {
  if (dashscopeKey && byteplusKey && dashscopeKey === byteplusKey) {
    return "DASHSCOPE_API_KEY matches BYTEPLUS_API_KEY. BytePlus ModelArk keys only power the text model here; voice chat transcription and Qwen TTS still require a real DashScope key.";
  }
  if (dashscopeKey && volcengineKey && dashscopeKey === volcengineKey) {
    return "DASHSCOPE_API_KEY matches VOLCENGINE_API_KEY. Volcengine ModelArk keys do not work for DashScope ASR/TTS.";
  }
  return null;
}

const aiProvider = (env.AI_PROVIDER || "gemini").trim().toLowerCase();
const geminiVoiceReady = Boolean(
  env.GOOGLE_CLOUD_PROJECT?.trim(),
);
const hasDash = Boolean(dashscopeKey) && !getDashscopeKeyIssue();

/**
 * Voice synthesis selection (single-provider for non-profile-intro callers).
 * Profile-intro uses the explicit Qwen → Gemini chain in `profile-media.ts`.
 *
 * Order: Qwen TTS (DashScope) → Gemini TTS. Same priority across CN/global so
 * voice replies stay inside the GFW where the Qwen key is set.
 */
const voiceSynthesisProvider: "qwen-tts" | "gemini-tts" = hasDash
  ? "qwen-tts"
  : "gemini-tts";

const voiceSynthesisEnabled = hasDash || geminiVoiceReady;

export function getVoiceTranscriptionConfigIssue(): string | null {
  const dashscopeIssue = getDashscopeKeyIssue();
  if (dashscopeIssue) return dashscopeIssue;
  if (!dashscopeKey) {
    if (aiProvider === "byteplus") {
      return "BytePlus voice input still requires DASHSCOPE_API_KEY for DashScope ASR. BYTEPLUS_API_KEY only powers the text reply.";
    }
    return "Voice input requires DASHSCOPE_API_KEY for DashScope ASR.";
  }
  return null;
}

export function getVoiceSynthesisConfigIssue(): string | null {
  const dashscopeIssue = getDashscopeKeyIssue();
  if (dashscopeIssue) return dashscopeIssue;
  if (hasDash || geminiVoiceReady) return null;
  return "Voice audio requires DASHSCOPE_API_KEY (Qwen TTS) or Vertex Gemini credentials (GOOGLE_CLOUD_PROJECT + GOOGLE_SERVICE_ACCOUNT_KEY).";
}

export const integrations = {
  voiceSynthesis: {
    enabled: voiceSynthesisEnabled,
    provider: voiceSynthesisProvider,
  },
  memory: {
    enabled: mem9Enabled,
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
    if (integrations.voiceSynthesis.provider === "gemini-tts") {
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

export type VoiceChatMode = "async" | "realtime" | "both";
export type RealtimeBackend = "ten" | "agora";

export function getVoiceChatMode(): VoiceChatMode {
  const raw = process.env.VOICE_CHAT_MODE?.toLowerCase().trim();
  if (raw === "realtime" || raw === "both") return raw;
  return "async";
}

export function isAsyncEnabled(): boolean {
  const mode = getVoiceChatMode();
  return mode === "async" || mode === "both";
}

export function isRealtimeEnabled(): boolean {
  const mode = getVoiceChatMode();
  return mode === "realtime" || mode === "both";
}

export function getRealtimeBackend(): RealtimeBackend {
  const raw = process.env.REALTIME_BACKEND?.toLowerCase().trim();
  return raw === "agora" ? "agora" : "ten";
}

export function isAgoraRealtimeBackend(): boolean {
  return getRealtimeBackend() === "agora";
}

export function isRealtimeReady(): boolean {
  if (!isRealtimeEnabled()) return false;
  const hasAgoraCore = !!process.env.AGORA_APP_ID && !!process.env.AGORA_APP_CERTIFICATE;
  if (!hasAgoraCore) return false;
  if (getRealtimeBackend() === "agora") return true;
  return !!process.env.TEN_AGENT_URL;
}

export function getVoiceChatClientConfig() {
  const mode = getVoiceChatMode();
  const realtimeBackend = getRealtimeBackend();
  return {
    mode,
    asyncEnabled: isAsyncEnabled(),
    realtimeEnabled: isRealtimeEnabled(),
    realtimeReady: isRealtimeReady(),
    realtimeBackend,
    agoraAppId: isRealtimeEnabled() ? process.env.AGORA_APP_ID ?? null : null,
  };
}

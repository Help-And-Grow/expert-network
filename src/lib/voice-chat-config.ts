export type VoiceChatMode = "async" | "realtime" | "both";

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

export function isRealtimeReady(): boolean {
  return (
    isRealtimeEnabled() &&
    !!process.env.AGORA_APP_ID &&
    !!process.env.AGORA_APP_CERTIFICATE &&
    !!process.env.TEN_AGENT_URL
  );
}

export function getVoiceChatClientConfig() {
  const mode = getVoiceChatMode();
  return {
    mode,
    asyncEnabled: isAsyncEnabled(),
    realtimeEnabled: isRealtimeEnabled(),
    realtimeReady: isRealtimeReady(),
    agoraAppId: isRealtimeEnabled() ? process.env.AGORA_APP_ID ?? null : null,
  };
}

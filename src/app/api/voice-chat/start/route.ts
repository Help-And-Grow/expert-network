import { type NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { resolveUserId } from "@/lib/request-auth";
import {
  getRealtimeBackend,
  isRealtimeEnabled,
  isRealtimeReady,
} from "@/lib/voice-chat-config";
import { generateRtcToken } from "@/lib/agora-token";
import {
  hasRealtimeSession,
  registerRealtimeSession,
  removeRealtimeSession,
  loadExpertVoiceChatProfile,
  startTenAgent,
  stopTenAgent,
  RT_MAX_DURATION_SECONDS,
} from "@/lib/voice-chat-session";

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const realtimeBackend = getRealtimeBackend();

  if (!isRealtimeEnabled()) {
    return NextResponse.json(
      { error: "Real-time voice chat is not enabled. Set VOICE_CHAT_MODE=realtime or both." },
      { status: 503 },
    );
  }

  if (!isRealtimeReady()) {
    return NextResponse.json(
      {
        error:
          realtimeBackend === "agora"
            ? "Real-time voice chat is enabled but not yet configured. AGORA_APP_ID and AGORA_APP_CERTIFICATE are required for the Agora backend."
            : "Real-time voice chat is enabled but not yet configured. AGORA_APP_ID, AGORA_APP_CERTIFICATE, and TEN_AGENT_URL are required for the TEN backend.",
      },
      { status: 503 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appId = process.env.AGORA_APP_ID!;

  let body: { expertId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { expertId } = body;
  if (!expertId) {
    return NextResponse.json({ error: "expertId is required" }, { status: 400 });
  }

  if (hasRealtimeSession(userId)) {
    return NextResponse.json(
      { error: "You already have an active voice chat session" },
      { status: 429 },
    );
  }

  const profile = await loadExpertVoiceChatProfile(expertId);
  if (!profile) {
    return NextResponse.json({ error: "Expert not found." }, { status: 404 });
  }
  if (profile.ownerUserId === userId) {
    return NextResponse.json(
      { error: "You cannot voice chat with your own expert profile." },
      { status: 403 },
    );
  }

  const channelName = `vc-${expertId}-${nanoid(8)}`;
  const userUid = Math.floor(Math.random() * 100000) + 1;
  const agentUid = userUid + 100000;

  let token: string;
  try {
    token = generateRtcToken(channelName, userUid);
  } catch (err) {
    console.error("[voice-chat/start] Token generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate voice channel token" },
      { status: 500 },
    );
  }

  const onTimeout = async (ch: string) => {
    console.log(`[voice-chat] Realtime session timed out: ${ch}`);
    removeRealtimeSession(ch);
    if (realtimeBackend === "ten") {
      await stopTenAgent(ch);
    }
  };

  registerRealtimeSession(channelName, expertId, userId, onTimeout);

  if (realtimeBackend === "ten") {
    const agentResult = await startTenAgent(channelName, agentUid, profile);
    if (!agentResult.ok) {
      console.warn("[voice-chat/start] TEN agent failed:", agentResult.error);
    }
  }

  return NextResponse.json({
    channelName,
    token,
    uid: userUid,
    appId,
    backend: realtimeBackend,
    maxDurationSeconds: RT_MAX_DURATION_SECONDS,
    expertName: profile.name,
    expertDomains: profile.domains,
  });
}

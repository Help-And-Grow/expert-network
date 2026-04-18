import { type NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { resolveUserId } from "@/lib/request-auth";
import { isRealtimeEnabled, isRealtimeReady } from "@/lib/voice-chat-config";
import {
  hasRealtimeSession,
  registerRealtimeSession,
  removeRealtimeSession,
  loadExpertVoiceChatProfile,
  RT_MAX_DURATION_SECONDS,
} from "@/lib/voice-chat-session";

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  if (!isRealtimeEnabled()) {
    return NextResponse.json(
      { error: "Real-time AI chat is not enabled. Set VOICE_CHAT_MODE=realtime or both." },
      { status: 503 },
    );
  }

  if (!isRealtimeReady()) {
    return NextResponse.json(
      { error: "Real-time AI chat requires DASHSCOPE_API_KEY." },
      { status: 503 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const sessionId = `rt-${expertId}-${nanoid(8)}`;

  const onTimeout = async (ch: string) => {
    console.log(`[voice-chat] Realtime session timed out: ${ch}`);
    removeRealtimeSession(ch);
  };

  registerRealtimeSession(sessionId, expertId, userId, onTimeout);

  return NextResponse.json({
    sessionId,
    maxDurationSeconds: RT_MAX_DURATION_SECONDS,
    expertName: profile.name,
    expertDomains: profile.domains,
  });
}

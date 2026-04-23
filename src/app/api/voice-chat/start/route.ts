import { type NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";

import { apiLog } from "@/lib/api-logger";
import { checkRateLimit } from "@/lib/rate-limit";
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

const startVoiceChatBodySchema = z.object({
  expertId: z.string().trim().min(1),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
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
    return NextResponse.json({ error: "Please sign in to chat with experts." }, { status: 401 });
  }

  const rateLimited = checkRateLimit(request, {
    namespace: "voice-chat:start",
    identifier: userId,
    limit: 8,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const parsed = startVoiceChatBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { expertId } = parsed.data;

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

  apiLog("info", "voice-chat/start", "session_started", request, {
    userId,
    expertId,
    sessionId,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    sessionId,
    maxDurationSeconds: RT_MAX_DURATION_SECONDS,
    expertName: profile.name,
    expertDomains: [],
  });
}

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiLog } from "@/lib/api-logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveUserId } from "@/lib/request-auth";
import { isRealtimeEnabled } from "@/lib/voice-chat-config";
import { getRealtimeSession, removeRealtimeSession } from "@/lib/voice-chat-session";

const stopVoiceChatBodySchema = z
  .object({
    sessionId: z.string().trim().min(1).optional(),
    channelName: z.string().trim().min(1).optional(),
  })
  .refine((body) => body.sessionId || body.channelName, {
    message: "sessionId is required",
  });

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  if (!isRealtimeEnabled()) {
    return NextResponse.json(
      { error: "Real-time AI chat is not enabled" },
      { status: 503 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Please sign in to chat with experts." }, { status: 401 });
  }

  const rateLimited = checkRateLimit(request, {
    namespace: "voice-chat:stop",
    identifier: userId,
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const parsed = stopVoiceChatBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = parsed.data.sessionId ?? parsed.data.channelName!;

  const session = getRealtimeSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "No active session found" }, { status: 404 });
  }

  if (session.userId !== userId) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }

  removeRealtimeSession(sessionId);

  const durationMs = Date.now() - session.startedAt;

  apiLog("info", "voice-chat/stop", "session_stopped", request, {
    userId,
    sessionId,
    sessionDurationMs: durationMs,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    ok: true,
    sessionId,
    durationMs,
    durationSeconds: Math.round(durationMs / 1000),
  });
}

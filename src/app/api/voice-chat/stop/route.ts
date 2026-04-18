import { type NextRequest, NextResponse } from "next/server";

import { resolveUserId } from "@/lib/request-auth";
import { isRealtimeEnabled } from "@/lib/voice-chat-config";
import { getRealtimeSession, removeRealtimeSession } from "@/lib/voice-chat-session";

export async function POST(request: NextRequest) {
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

  let body: { sessionId?: string; channelName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.sessionId ?? body.channelName;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const session = getRealtimeSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "No active session found" }, { status: 404 });
  }

  if (session.userId !== userId) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }

  removeRealtimeSession(sessionId);

  const durationMs = Date.now() - session.startedAt;

  return NextResponse.json({
    ok: true,
    sessionId,
    durationMs,
    durationSeconds: Math.round(durationMs / 1000),
  });
}

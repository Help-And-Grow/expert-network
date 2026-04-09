import { type NextRequest, NextResponse } from "next/server";

import { resolveUserId } from "@/lib/request-auth";
import { getRealtimeBackend, isRealtimeEnabled } from "@/lib/voice-chat-config";
import {
  getRealtimeSession,
  removeRealtimeSession,
  stopTenAgent,
} from "@/lib/voice-chat-session";

export async function POST(request: NextRequest) {
  const realtimeBackend = getRealtimeBackend();

  if (!isRealtimeEnabled()) {
    return NextResponse.json(
      { error: "Real-time voice chat is not enabled" },
      { status: 503 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { channelName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { channelName } = body;
  if (!channelName) {
    return NextResponse.json({ error: "channelName is required" }, { status: 400 });
  }

  const session = getRealtimeSession(channelName);
  if (!session) {
    return NextResponse.json({ error: "No active session found" }, { status: 404 });
  }

  if (session.userId !== userId) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }

  removeRealtimeSession(channelName);
  if (realtimeBackend === "ten") {
    await stopTenAgent(channelName).catch(() => {});
  }

  const durationMs = Date.now() - session.startedAt;

  return NextResponse.json({
    ok: true,
    channelName,
    durationMs,
    durationSeconds: Math.round(durationMs / 1000),
  });
}

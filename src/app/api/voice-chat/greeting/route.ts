import { type NextRequest, NextResponse } from "next/server";

import { resolveUserId } from "@/lib/request-auth";
import {
  isAgoraRealtimeBackend,
  isAsyncEnabled,
  isRealtimeEnabled,
} from "@/lib/voice-chat-config";
import { getVoiceChatGreeting } from "@/lib/voice-chat-session";

export const maxDuration = 30;

/**
 * POST /api/voice-chat/greeting
 * Body: { expertId }
 * Returns synthesized welcome audio (same voice as chat) + text. Does not use a turn.
 */
export async function POST(request: NextRequest) {
  const canServeGreeting =
    isAsyncEnabled() || (isRealtimeEnabled() && isAgoraRealtimeBackend());

  if (!canServeGreeting) {
    return NextResponse.json(
      { error: "Voice preview is not enabled for the current voice-chat configuration." },
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

  try {
    const result = await getVoiceChatGreeting(userId, expertId);
    if (!result) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    return NextResponse.json({
      replyText: result.text,
      replyAudio:
        result.replyAudioBase64 && result.replyAudioFormat
          ? `data:audio/${result.replyAudioFormat};base64,${result.replyAudioBase64}`
          : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[voice-chat/greeting]", msg);
    return NextResponse.json(
      { error: msg || "Failed to generate greeting" },
      { status: msg.includes("own expert profile") ? 403 : 500 },
    );
  }
}

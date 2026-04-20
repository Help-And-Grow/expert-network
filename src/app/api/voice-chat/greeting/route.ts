import { type NextRequest, NextResponse } from "next/server";

import { buildProfileAudioDataUrl } from "@/lib/profile-media";
import { resolveUserId } from "@/lib/request-auth";
import {
  isAsyncEnabled,
  isRealtimeEnabled,
} from "@/lib/voice-chat-config";
import {
  getRealtimeChatGreeting,
  getVoiceChatGreeting,
} from "@/lib/voice-chat-session";

export const maxDuration = 30;

/**
 * POST /api/voice-chat/greeting
 * Body: { expertId }
 * Returns welcome text plus optional synthesized audio. Does not use a turn.
 */
export async function POST(request: NextRequest) {
  const canServeGreeting = isAsyncEnabled() || isRealtimeEnabled();

  if (!canServeGreeting) {
    return NextResponse.json(
      { error: "AI chat preview is not enabled for the current configuration." },
      { status: 503 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Please sign in to chat with experts." }, { status: 401 });
  }

  let body: { expertId?: string; includeAudio?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { expertId, includeAudio = true } = body;
  if (!expertId) {
    return NextResponse.json({ error: "expertId is required" }, { status: 400 });
  }

  try {
    const result = includeAudio
      ? await getVoiceChatGreeting(userId, expertId)
      : await getRealtimeChatGreeting(userId, expertId);
    if (!result) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    const audioResult = includeAudio
      ? (result as {
          text: string;
          replyAudioBase64?: string;
          replyAudioFormat?: string;
        })
      : null;

    return NextResponse.json({
      replyText: result.text,
      replyAudio:
        audioResult?.replyAudioBase64 && audioResult.replyAudioFormat
          ? buildProfileAudioDataUrl({
              audioBase64: audioResult.replyAudioBase64,
              format: audioResult.replyAudioFormat,
            })
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

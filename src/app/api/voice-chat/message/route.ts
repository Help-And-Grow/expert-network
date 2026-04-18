import { type NextRequest, NextResponse } from "next/server";

import { resolveUserId } from "@/lib/request-auth";
import {
  isAsyncEnabled,
  isRealtimeEnabled,
} from "@/lib/voice-chat-config";
import {
  processVoiceDrafts,
  processVoiceMessage,
  processTextMessage,
} from "@/lib/voice-chat-session";

export const maxDuration = 30;

/**
 * POST /api/voice-chat/message
 *
 * Accepts voice or text, returns AI reply as text + optional audio.
 * Used by async voice chat and realtime AI chat.
 */
export async function POST(request: NextRequest) {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      if (!isAsyncEnabled()) {
        return NextResponse.json(
          { error: "Voice messages are not enabled for the current configuration." },
          { status: 503 },
        );
      }
      return await handleVoiceMessage(request, userId);
    }
    if (!isAsyncEnabled() && !isRealtimeEnabled()) {
      return NextResponse.json(
        { error: "AI chat is not enabled for the current configuration." },
        { status: 503 },
      );
    }
    return await handleTextMessage(request, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[voice-chat/message]", msg);

    const status = msg.includes("Turn limit")
      ? 429
      : msg.includes("Expert not found")
        ? 404
        : msg.includes("own expert profile")
          ? 403
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

async function handleVoiceMessage(request: NextRequest, userId: string) {
  const formData = await request.formData();
  const expertId = formData.get("expertId") as string | null;
  const audioFile = formData.get("audio");

  if (!expertId) {
    return NextResponse.json({ error: "expertId is required" }, { status: 400 });
  }
  if (!audioFile || !(audioFile instanceof Blob)) {
    return NextResponse.json({ error: "audio file is required" }, { status: 400 });
  }

  const arrayBuf = await audioFile.arrayBuffer();
  const audioBase64 = Buffer.from(arrayBuf).toString("base64");
  const mimeType = audioFile.type || "audio/webm";

  const result = await processVoiceMessage(userId, expertId, audioBase64, mimeType);

  return NextResponse.json({
    userText: result.userText,
    replyText: result.replyText,
    replyAudio:
      result.replyAudioBase64 && result.replyAudioFormat
        ? `data:audio/${result.replyAudioFormat};base64,${result.replyAudioBase64}`
        : null,
    turnCount: result.turnCount,
    maxTurns: result.maxTurns,
  });
}

async function handleTextMessage(request: NextRequest, userId: string) {
  let body: {
    expertId?: string;
    text?: string;
    includeAudio?: boolean;
    audioClips?: Array<{ audioBase64?: string; mimeType?: string }>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { expertId, text, audioClips, includeAudio = true } = body;
  if (!expertId) {
    return NextResponse.json({ error: "expertId is required" }, { status: 400 });
  }
  if (Array.isArray(audioClips) && audioClips.length > 0) {
    if (!isAsyncEnabled()) {
      return NextResponse.json(
        { error: "Voice drafts are not enabled for the current configuration." },
        { status: 503 },
      );
    }
    const normalized = audioClips
      .map((clip) => ({
        audioBase64: clip.audioBase64?.trim() ?? "",
        mimeType: clip.mimeType?.trim() || "audio/mpeg",
      }))
      .filter((clip) => clip.audioBase64.length > 0);

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: "audioClips must include at least one base64 payload" },
        { status: 400 },
      );
    }

    const result = await processVoiceDrafts(userId, expertId, normalized);
    return NextResponse.json({
      userText: result.userText,
      replyText: result.replyText,
      replyAudio:
        result.replyAudioBase64 && result.replyAudioFormat
          ? `data:audio/${result.replyAudioFormat};base64,${result.replyAudioBase64}`
          : null,
      turnCount: result.turnCount,
      maxTurns: result.maxTurns,
    });
  }
  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const result = await processTextMessage(userId, expertId, text.trim(), {
    synthesizeAudio: includeAudio,
  });

  return NextResponse.json({
    userText: result.userText,
    replyText: result.replyText,
    replyAudio:
      result.replyAudioBase64 && result.replyAudioFormat
        ? `data:audio/${result.replyAudioFormat};base64,${result.replyAudioBase64}`
        : null,
    turnCount: result.turnCount,
    maxTurns: result.maxTurns,
  });
}

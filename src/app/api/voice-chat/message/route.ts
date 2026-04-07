import { type NextRequest, NextResponse } from "next/server";

import { resolveUserId } from "@/lib/request-auth";
import { isAsyncEnabled } from "@/lib/voice-chat-config";
import {
  processVoiceMessage,
  processTextMessage,
} from "@/lib/voice-chat-session";

export const maxDuration = 30;

/**
 * POST /api/voice-chat/message
 *
 * Async voice chat: accepts voice or text, returns AI reply as text + audio.
 * Only available when VOICE_CHAT_MODE is "async" or "both".
 */
export async function POST(request: NextRequest) {
  if (!isAsyncEnabled()) {
    return NextResponse.json(
      { error: "Async voice chat is not enabled. Set VOICE_CHAT_MODE=async or both." },
      { status: 503 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      return await handleVoiceMessage(request, userId);
    }
    return await handleTextMessage(request, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[voice-chat/message]", msg);

    const status = msg.includes("Turn limit") ? 429 : msg.includes("cloned voice") ? 404 : 500;
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
    replyAudio: `data:audio/${result.replyAudioFormat};base64,${result.replyAudioBase64}`,
    turnCount: result.turnCount,
    maxTurns: result.maxTurns,
  });
}

async function handleTextMessage(request: NextRequest, userId: string) {
  let body: { expertId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { expertId, text } = body;
  if (!expertId) {
    return NextResponse.json({ error: "expertId is required" }, { status: 400 });
  }
  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const result = await processTextMessage(userId, expertId, text.trim());

  return NextResponse.json({
    userText: result.userText,
    replyText: result.replyText,
    replyAudio: `data:audio/${result.replyAudioFormat};base64,${result.replyAudioBase64}`,
    turnCount: result.turnCount,
    maxTurns: result.maxTurns,
  });
}

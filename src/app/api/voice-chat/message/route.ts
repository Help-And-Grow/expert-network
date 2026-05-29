import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiLog } from "@/lib/api-logger";
import { buildProfileAudioDataUrl } from "@/lib/profile-media";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveUserId } from "@/lib/request-auth";
import {
  isAsyncEnabled,
  isRealtimeEnabled,
} from "@/lib/voice-chat-config";
import { checkAndIncrementUsage } from "@/lib/voice-chat-usage";
import {
  getRealtimeSession,
  processVoiceDrafts,
  processVoiceMessage,
  processTextMessage,
} from "@/lib/voice-chat-session";

export const maxDuration = 120;

const MAX_AUDIO_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_CLIPS = 3;
const MAX_AUDIO_BASE64_CHARS = 14_000_000;

const textMessageBodySchema = z.object({
  expertId: z.string().trim().min(1),
  text: z.string().optional(),
  includeAudio: z.boolean().optional(),
  audioClips: z
    .array(
      z.object({
        audioBase64: z.string().max(MAX_AUDIO_BASE64_CHARS).optional(),
        mimeType: z.string().trim().max(120).optional(),
      }),
    )
    .max(MAX_AUDIO_CLIPS)
    .optional(),
  sessionId: z.string().trim().min(1).optional(),
});

/**
 * POST /api/voice-chat/message
 *
 * Accepts voice or text, returns AI reply as text + optional audio.
 * Used by async voice chat and realtime AI chat.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Please sign in to chat with experts." }, { status: 401 });
  }

  const rateLimited = checkRateLimit(request, {
    namespace: "voice-chat:message",
    identifier: userId,
    limit: 24,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    let response: NextResponse;
    if (contentType.includes("multipart/form-data")) {
      if (!isAsyncEnabled()) {
        return NextResponse.json(
          { error: "Voice messages are not enabled for the current configuration." },
          { status: 503 },
        );
      }
      response = await handleVoiceMessage(request, userId);
    } else if (!isAsyncEnabled() && !isRealtimeEnabled()) {
      return NextResponse.json(
        { error: "AI chat is not enabled for the current configuration." },
        { status: 503 },
      );
    } else {
      response = await handleTextMessage(request, userId);
    }
    apiLog("info", "voice-chat/message", "completed", request, {
      userId,
      status: response.status,
      durationMs: Date.now() - startedAt,
      multipart: contentType.includes("multipart/form-data"),
    });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiLog("error", "voice-chat/message", "failed", request, {
      userId,
      durationMs: Date.now() - startedAt,
      error: msg,
    });

    const status = msg.includes("Turn limit") || msg.includes("Free reply limit")
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
  if (audioFile.size > MAX_AUDIO_UPLOAD_BYTES) {
    return NextResponse.json({ error: "audio file is too large" }, { status: 413 });
  }

  const arrayBuf = await audioFile.arrayBuffer();
  const audioBase64 = Buffer.from(arrayBuf).toString("base64");
  const mimeType = audioFile.type || "audio/webm";

  await checkAndIncrementUsage(expertId);
  const result = await processVoiceMessage(userId, expertId, audioBase64, mimeType);

  return NextResponse.json({
    userText: result.userText,
    replyText: result.replyText,
    replyAudio:
      result.replyAudioBase64 && result.replyAudioFormat
        ? buildProfileAudioDataUrl({
            audioBase64: result.replyAudioBase64,
            format: result.replyAudioFormat,
          })
        : null,
    turnCount: result.turnCount,
    maxTurns: result.maxTurns,
  });
}

async function handleTextMessage(request: NextRequest, userId: string) {
  const parsed = textMessageBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const body = parsed.data;
  const { expertId, text, audioClips, includeAudio = true, sessionId } = body;
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

    await checkAndIncrementUsage(expertId);
    const result = await processVoiceDrafts(userId, expertId, normalized);
    return NextResponse.json({
      userText: result.userText,
      replyText: result.replyText,
      replyAudio:
        result.replyAudioBase64 && result.replyAudioFormat
          ? buildProfileAudioDataUrl({
              audioBase64: result.replyAudioBase64,
              format: result.replyAudioFormat,
            })
          : null,
      turnCount: result.turnCount,
      maxTurns: result.maxTurns,
    });
  }
  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (!sessionId && !isAsyncEnabled()) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (sessionId) {
    if (!isRealtimeEnabled()) {
      return NextResponse.json(
        { error: "Real-time AI chat is not enabled for the current configuration." },
        { status: 503 },
      );
    }

    const session = getRealtimeSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "No active session found" }, { status: 404 });
    }
    if (session.userId !== userId) {
      return NextResponse.json({ error: "Not your session" }, { status: 403 });
    }
    if (session.expertId !== expertId) {
      return NextResponse.json(
        { error: "Session does not match this expert." },
        { status: 403 },
      );
    }
  }

  await checkAndIncrementUsage(expertId);
  const result = await processTextMessage(userId, expertId, text.trim(), {
    synthesizeAudio: includeAudio,
    voiceSynthesisTimeoutMs: includeAudio ? 10_000 : undefined,
  });

  return NextResponse.json({
    userText: result.userText,
    replyText: result.replyText,
    replyAudio:
      result.replyAudioBase64 && result.replyAudioFormat
        ? buildProfileAudioDataUrl({
            audioBase64: result.replyAudioBase64,
            format: result.replyAudioFormat,
          })
        : null,
    turnCount: result.turnCount,
    maxTurns: result.maxTurns,
  });
}

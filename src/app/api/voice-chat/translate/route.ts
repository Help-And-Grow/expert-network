import { type NextRequest, NextResponse } from "next/server";

import { resolveUserId } from "@/lib/request-auth";
import {
  isAsyncEnabled,
  isRealtimeEnabled,
} from "@/lib/voice-chat-config";
import {
  VOICE_CHAT_TRANSLATION_TARGETS,
  type VoiceChatTranslationTarget,
} from "@/lib/voice-chat-translation";
import { translateVoiceChatText } from "@/lib/voice-chat-session";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!isAsyncEnabled() && !isRealtimeEnabled()) {
    return NextResponse.json(
      { error: "AI chat is not enabled for the current configuration." },
      { status: 503 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    targetLanguage?: VoiceChatTranslationTarget;
    text?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const targetLanguage = body.targetLanguage;
  if (!targetLanguage || !VOICE_CHAT_TRANSLATION_TARGETS.includes(targetLanguage)) {
    return NextResponse.json(
      { error: "targetLanguage must be english or chinese" },
      { status: 400 },
    );
  }

  try {
    const translatedText = await translateVoiceChatText(text, targetLanguage);
    return NextResponse.json({ translatedText });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to translate message.";
    console.error("[voice-chat/translate]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

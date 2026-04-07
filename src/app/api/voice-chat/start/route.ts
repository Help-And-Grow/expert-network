import { type NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { resolveUserId } from "@/lib/request-auth";
import { generateRtcToken } from "@/lib/agora-token";
import {
  hasActiveSession,
  registerSession,
  removeSession,
  loadExpertVoiceChatProfile,
  startTenAgent,
  stopTenAgent,
  MAX_DURATION_SECONDS,
} from "@/lib/voice-chat-session";

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appId = process.env.AGORA_APP_ID;
  if (!appId) {
    return NextResponse.json(
      { error: "Voice chat is not configured" },
      { status: 503 },
    );
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

  if (hasActiveSession(userId)) {
    return NextResponse.json(
      { error: "You already have an active voice chat session" },
      { status: 429 },
    );
  }

  const profile = await loadExpertVoiceChatProfile(expertId);
  if (!profile) {
    return NextResponse.json(
      { error: "Expert does not have a cloned voice. Voice chat is unavailable." },
      { status: 404 },
    );
  }

  const channelName = `vc-${expertId}-${nanoid(8)}`;
  const userUid = Math.floor(Math.random() * 100000) + 1;
  const agentUid = userUid + 100000;

  let token: string;
  try {
    token = generateRtcToken(channelName, userUid);
  } catch (err) {
    console.error("[voice-chat/start] Token generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate voice channel token" },
      { status: 500 },
    );
  }

  const onTimeout = async (ch: string) => {
    console.log(`[voice-chat] Session timed out: ${ch}`);
    removeSession(ch);
    await stopTenAgent(ch);
  };

  registerSession(channelName, expertId, userId, onTimeout);

  const agentResult = await startTenAgent(channelName, agentUid, profile);
  if (!agentResult.ok) {
    console.warn("[voice-chat/start] TEN agent failed to start:", agentResult.error);
  }

  return NextResponse.json({
    channelName,
    token,
    uid: userUid,
    appId,
    maxDurationSeconds: MAX_DURATION_SECONDS,
    expertName: profile.name,
    expertDomains: profile.domains,
  });
}

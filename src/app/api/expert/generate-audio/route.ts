import { type NextRequest, NextResponse } from "next/server";

import {
  buildProfileAudioDataUrl,
  getProfileIntroVoiceSynthesisProviders,
} from "@/lib/profile-media";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const voiceSynthesisProviders = await getProfileIntroVoiceSynthesisProviders();
    if (voiceSynthesisProviders.length === 0) {
      return NextResponse.json(
        { error: "Voice synthesis is not configured" },
        { status: 503 }
      );
    }

    const expert = await prisma.expert.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!expert) {
      return NextResponse.json(
        { error: "Expert profile not found" },
        { status: 404 }
      );
    }

    const script = expert.avatarScript;
    if (!script) {
      return NextResponse.json(
        { error: "No introduction script found. Generate your profile first." },
        { status: 400 }
      );
    }

    let dataUrl: string | null = null;
    let lastError: unknown = null;

    for (const voiceSynthesis of voiceSynthesisProviders) {
      const voiceId = voiceSynthesis.getDefaultVoiceId?.(expert.gender) ?? undefined;
      try {
        const result = await voiceSynthesis.synthesize({
          text: script,
          voiceId,
          format: "mp3",
          speed: 1.0,
        });
        dataUrl = buildProfileAudioDataUrl(result);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!dataUrl) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Voice synthesis returned no playable audio.");
    }

    await prisma.expert.update({
      where: { id: expert.id },
      data: { audioIntroUrl: dataUrl },
    });

    return NextResponse.json({ audioIntroUrl: dataUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[expert/generate-audio POST]", message, error);
    return NextResponse.json(
      { error: "Failed to generate audio intro", detail: message },
      { status: 500 }
    );
  }
}

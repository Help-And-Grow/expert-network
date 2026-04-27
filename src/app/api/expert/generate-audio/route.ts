import { type NextRequest, NextResponse } from "next/server";

import {
  getProfileIntroVoiceSynthesisProviders,
} from "@/lib/profile-media";
import { getStorageProvider } from "@/lib/storage";
import { normalizeAudioForBrowserPlayback } from "@/lib/audio-format";
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

    let audioBuffer: Buffer | null = null;
    let audioMime: string | null = null;
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
        
        const normalizedBase64 = result.audioBase64.replace(/\s+/g, "");
        const buffer = Buffer.from(normalizedBase64, "base64");
        if (buffer.length === 0) {
          throw new Error("Voice synthesis returned empty audio.");
        }
        const normalized = normalizeAudioForBrowserPlayback({
          buffer,
          declaredMime: result.format?.includes("/") ? result.format : null,
          declaredFormat: result.format,
        });
        audioBuffer = normalized.buffer;
        audioMime = normalized.mimeType;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!audioBuffer || !audioMime) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Voice synthesis returned no playable audio.");
    }

    const storage = await getStorageProvider();
    const storagePath = `experts/${expert.id}/audio-intro-${Date.now()}.mp3`;
    const audioUrl = await storage.upload(storagePath, audioBuffer, {
      contentType: audioMime,
    });

    await prisma.expert.update({
      where: { id: expert.id },
      data: { audioIntroUrl: audioUrl },
    });

    return NextResponse.json({ audioIntroUrl: audioUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[expert/generate-audio POST]", message, error);
    return NextResponse.json(
      { error: "Failed to generate audio intro", detail: message },
      { status: 500 }
    );
  }
}

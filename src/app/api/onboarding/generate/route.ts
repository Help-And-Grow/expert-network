import { type NextRequest, NextResponse } from "next/server";

import { generateExpertProfile } from "@/lib/ai";
import { normalizeAudioForBrowserPlayback } from "@/lib/audio-format";
import {
  generateProfileImageResilient,
  getProfileIntroVoiceSynthesisProviders,
} from "@/lib/profile-media";
import { getStorageProvider } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

export const maxDuration = 60;

/**
 * Fallback when the LLM bio generator fails. The user lands on PREVIEW with
 * an editable starter rather than a hard error — they can rewrite it inline.
 */
function fallbackProfile(nickName: string, services: string[]) {
  const offering = services.length > 0 ? services.join(", ") : "professional services";
  const bio = `${nickName} is an active member of the Help & Grow community offering ${offering}. Edit this introduction to share more about your background and what you can help others with.`;
  return {
    bio,
    services: services.map((title) => ({ title })),
    videoScript: bio,
  };
}

export async function POST(request: NextRequest) {
  // Stage label gets attached to every uncaught error so the outer catch
  // returns a precise message — "Profile generation failed at <stage>:
  // <detail>" — instead of the generic "Internal server error" which
  // hides whether DB, storage, AI, or persistence was the actual culprit.
  let stage = "init";
  try {
    stage = "auth";
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Scope the user select to the only fields we need. `include: { user: true }`
    // would pull every User column — if a recently-added column (e.g. the
    // membership fields) is in the Prisma schema but not yet in the DB,
    // Prisma errors out the entire route with a generic 500. Selecting
    // explicit columns keeps onboarding working through migration lag.
    stage = "load-expert";
    const expert = await prisma.expert.findUnique({
      where: { userId },
      include: {
        user: { select: { nickName: true, name: true } },
      },
    });

    if (!expert) {
      return NextResponse.json(
        { error: "Expert profile not found. Complete onboarding first." },
        { status: 404 }
      );
    }

    const nickName =
      expert.user.nickName ?? expert.user.name ?? "Expert";

    const profileInput = {
      linkedIn: expert.linkedIn ?? undefined,
      website: expert.website ?? undefined,
      twitter: expert.twitter ?? undefined,
      substack: expert.substack ?? undefined,
      instagram: expert.instagram ?? undefined,
      xiaohongshu: expert.xiaohongshu ?? undefined,
      nickName,
      resumeText: expert.avatarScript ?? undefined,
    };

    /** Per-generator failure reason, surfaced to the UI so the user (or dev) knows what's wrong without reading server logs. */
    const diagnostics: { text?: string; image?: string; audio?: string } = {};
    const errorMessage = (error: unknown): string =>
      error instanceof Error ? error.message : String(error);

    stage = "ai-generate";
    // Run text + image generation in parallel. Both have graceful fallbacks
    // so a single provider failure doesn't strand the user on a 500 page.
    const [generated, profileImage] = await Promise.all([
      generateExpertProfile(profileInput).catch((error) => {
        console.error("[onboarding/generate POST] profile text generation failed", error);
        diagnostics.text = errorMessage(error);
        return null;
      }),
      generateProfileImageResilient({
        nickName,
        bio: expert.bio ?? "",
        gender: expert.gender ?? undefined,
      }).catch((error) => {
        console.error("[onboarding/generate POST] profile image generation failed", error);
        diagnostics.image = errorMessage(error);
        return null;
      }),
    ]);

    const usedFallback = generated === null;
    const profile =
      generated ??
      fallbackProfile(
        nickName,
        Array.isArray(expert.servicesOffered)
          ? (expert.servicesOffered as Array<{ title?: string }>)
              .map((s) => s.title ?? "")
              .filter(Boolean)
          : [],
      );

    stage = "storage-init";
    let storage: Awaited<ReturnType<typeof getStorageProvider>>;
    try {
      storage = await getStorageProvider({ request });
    } catch (storageError) {
      // Storage is required for image and audio uploads. Without it we can
      // still return the bio so the user has something to edit, but image
      // and audio are lost. Don't 500 the whole route over a missing env.
      const detail = errorMessage(storageError);
      console.error("[onboarding/generate POST] storage init failed", detail, storageError);
      diagnostics.image = `storage init failed: ${detail}`;
      diagnostics.audio = `storage init failed: ${detail}`;
      // @ts-expect-error — never used when storage init failed; gated below.
      storage = null;
    }

    let finalImageUrl: string | null = profileImage;
    if (profileImage && profileImage.startsWith("data:") && storage) {
      stage = "image-upload";
      try {
        const [meta, data] = profileImage.split(",");
        const mime = meta.match(/:(.*?);/)?.[1] || "image/png";
        const buffer = Buffer.from(data, "base64");
        const ext = mime.split("/")[1] || "png";
        const storagePath = `experts/${expert.id}/avatar-${Date.now()}.${ext}`;

        finalImageUrl = await storage.upload(storagePath, buffer, {
          contentType: mime,
        });
      } catch (error) {
        console.error("[onboarding/generate POST] failed to upload image to storage", error);
        diagnostics.image = `upload failed: ${errorMessage(error)}`;
        finalImageUrl = null;
      }
    }

    stage = "audio-intro";
    // Voice intro — best-effort. Audio generation runs after text so we can
    // synthesize from the freshly-generated avatarScript without a second
    // round-trip.
    let audioIntroUrl: string | null = null;
    try {
      const providers = await getProfileIntroVoiceSynthesisProviders();
      if (providers.length === 0) {
        diagnostics.audio = "no voice synthesis providers configured (set DASHSCOPE_API_KEY for Qwen TTS or GEMINI_API_KEY for Gemini TTS)";
      } else if (!profile.videoScript) {
        diagnostics.audio = "no script available — text generation must succeed first";
      } else if (!storage) {
        diagnostics.audio = "audio buffer generated but storage is unavailable";
      } else {
        const synthErrors: string[] = [];
        for (const synth of providers) {
          const voiceId = synth.getDefaultVoiceId?.(expert.gender) ?? undefined;
          try {
            const result = await synth.synthesize({
              text: profile.videoScript,
              voiceId,
              format: "mp3",
              speed: 1.0,
            });
            const buffer = Buffer.from(result.audioBase64.replace(/\s+/g, ""), "base64");
            if (buffer.length === 0) {
              synthErrors.push("empty audio buffer");
              continue;
            }
            const normalized = normalizeAudioForBrowserPlayback({
              buffer,
              declaredMime: result.format?.includes("/") ? result.format : null,
              declaredFormat: result.format,
            });
            const storagePath = `experts/${expert.id}/audio-intro-${Date.now()}.mp3`;
            audioIntroUrl = await storage.upload(storagePath, normalized.buffer, {
              contentType: normalized.mimeType,
            });
            break;
          } catch (synthError) {
            console.warn("[onboarding/generate POST] voice synth attempt failed", synthError);
            synthErrors.push(errorMessage(synthError));
          }
        }
        if (!audioIntroUrl) {
          diagnostics.audio = `all providers failed: ${synthErrors.join("; ")}`;
        }
      }
    } catch (error) {
      console.error("[onboarding/generate POST] voice intro generation failed", error);
      diagnostics.audio = errorMessage(error);
    }

    stage = "persist";
    // Persist what we generated. A DB-level failure here shouldn't strand the
    // user with a generic 500 — return the generated assets so the UI can
    // show the bio/image/audio for editing while the user retries the save.
    let persisted = true;
    try {
      await prisma.expert.update({
        where: { id: expert.id },
        data: {
          bio: profile.bio,
          servicesOffered: profile.services as object,
          avatarScript: profile.videoScript,
          avatarVideoUrl: finalImageUrl,
          ...(audioIntroUrl ? { audioIntroUrl } : {}),
          onboardingStep: "AI_GENERATION",
        },
      });
    } catch (dbError) {
      persisted = false;
      const detail = errorMessage(dbError);
      console.error("[onboarding/generate POST] expert.update failed", detail, dbError);
      diagnostics.text = diagnostics.text
        ? `${diagnostics.text}; persistence failed: ${detail}`
        : `persistence failed: ${detail}`;
    }

    return NextResponse.json({
      expertId: expert.id,
      bio: profile.bio,
      services: profile.services,
      videoScript: profile.videoScript,
      profileImage: finalImageUrl,
      audioIntroUrl,
      usedFallback,
      persisted,
      diagnostics,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[onboarding/generate POST] uncaught at stage=${stage}`, message, error);
    return NextResponse.json(
      {
        error: "Profile generation failed",
        stage,
        detail: message,
      },
      { status: 500 }
    );
  }
}

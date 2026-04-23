import { type NextRequest, NextResponse } from "next/server";

import { generateExpertProfile } from "@/lib/ai";
import { generateProfileImageResilient } from "@/lib/profile-media";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const expert = await prisma.expert.findUnique({
      where: { userId },
      include: { user: true },
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

    // Run text generation and image generation in parallel
    const [generated, profileImage] = await Promise.all([
      generateExpertProfile(profileInput),
      generateProfileImageResilient({
        nickName,
        bio: expert.bio ?? "",
        gender: expert.gender ?? undefined,
      }).catch((error) => {
        console.error("[onboarding/generate POST] profile image generation failed", error);
        return null;
      }),
    ]);

    await prisma.expert.update({
      where: { id: expert.id },
      data: {
        bio: generated.bio,
        servicesOffered: generated.services as object,
        avatarScript: generated.videoScript,
        avatarVideoUrl: profileImage,
        onboardingStep: "AI_GENERATION",
      },
    });

    return NextResponse.json({
      expertId: expert.id,
      bio: generated.bio,
      services: generated.services,
      videoScript: generated.videoScript,
      profileImage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[onboarding/generate POST]", message, error);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 }
    );
  }
}

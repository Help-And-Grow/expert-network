import { type NextRequest, NextResponse } from "next/server";

import { seedExpertProfile } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

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

    if (!expert.documentData || !expert.documentName) {
      return NextResponse.json(
        {
          error: "Please upload your service introduction PDF before publishing.",
          code: "SERVICE_PDF_REQUIRED",
        },
        { status: 400 }
      );
    }

    const updated = await prisma.expert.update({
      where: { id: expert.id },
      data: {
        isPublished: true,
        onboardingStep: "PUBLISHED",
      },
    });

    // Fire-and-forget: provision mem9 space and seed profile memories
    seedExpertProfile({
      expertId: expert.id,
      nickName: expert.user.nickName ?? expert.user.name ?? "Expert",
      bio: expert.bio ?? "",
      services: (expert.servicesOffered as unknown[]) ?? [],
      socialLinks: {
        linkedIn: expert.linkedIn,
        website: expert.website,
        twitter: expert.twitter,
        substack: expert.substack,
        instagram: expert.instagram,
        xiaohongshu: expert.xiaohongshu,
      },
    }).catch(() => {});

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[onboarding/publish POST]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

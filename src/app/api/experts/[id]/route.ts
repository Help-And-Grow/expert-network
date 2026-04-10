import { type NextRequest, NextResponse } from "next/server";

import type { ExperienceCapabilities } from "@expert-network/shared-api";

import { domainStrings } from "@/lib/domains";
import { prisma } from "@/lib/prisma";

function buildExperienceCapabilities(origin: string, expertId: string, hasAudio: boolean): ExperienceCapabilities {
  const publicProfilePath = `/experts/${expertId}?from=wechat`;
  return {
    voiceIntroAvailable: hasAudio,
    voiceConsult: {
      enabled: true,
      freeReplyLimit: 5,
      groupedDrafts: true,
      replyStyle: "single concise expert voice reply under 60 seconds",
    },
    realtimeVoice: {
      enabled: true,
      availableNow: false,
      premiumOnly: true,
      durationSeconds: 180,
    },
    web: {
      publicProfileUrl: `${origin}${publicProfilePath}`,
      loginFirstProfileUrl: `${origin}/auth/signin?callbackUrl=${encodeURIComponent(publicProfilePath)}`,
    },
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "Expert ID is required" },
        { status: 400 }
      );
    }

    const expert = await prisma.expert.findUnique({
      where: {
        id,
        isPublished: true,
      },
      include: {
        domains: true,
        user: {
          select: {
            id: true,
            name: true,
            nickName: true,
            image: true,
            email: true,
          },
        },
        reviews: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            founder: {
              select: {
                id: true,
                name: true,
                nickName: true,
                image: true,
              },
            },
          },
        },
      },
    });

    if (!expert) {
      return NextResponse.json(
        { error: "Expert not found" },
        { status: 404 }
      );
    }

    // Calculate stats: Learned from XX+ mentors, helped YY+ mentees
    const [learnedFromCount, offeredHelpCount] = await Promise.all([
      prisma.booking.groupBy({
        by: ["expertId"],
        where: {
          founderId: expert.userId,
          status: "COMPLETED",
        },
      }).then((groups) => groups.length),
      prisma.booking.groupBy({
        by: ["founderId"],
        where: {
          expertId: expert.id,
          status: "COMPLETED",
        },
      }).then((groups) => groups.length),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { documentData: _dd, avatarVideoUrl: _av, audioIntroUrl: _ai, domains: domainRows, ...rest } = expert;
    const origin = new URL(request.url).origin;
    const experienceCapabilities = buildExperienceCapabilities(
      origin,
      expert.id,
      !!expert.audioIntroUrl,
    );

    return NextResponse.json({
      ...rest,
      domains: domainStrings(domainRows),
      hasAvatar: !!expert.avatarVideoUrl,
      hasAudio: !!expert.audioIntroUrl,
      hasClonedVoice: !!expert.fishAudioModelId,
      /** Voice chat works with clone or built-in default voice */
      hasVoiceChat: true,
      experienceCapabilities,
      learnedFromCount,
      offeredHelpCount,
    });

  } catch (error) {
    console.error("[experts/[id] GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { type NextRequest, NextResponse } from "next/server";

import { domainStrings } from "@/lib/domains";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { documentData: _dd, avatarVideoUrl: _av, audioIntroUrl: _ai, domains: domainRows, ...rest } = expert;

    return NextResponse.json({
      ...rest,
      domains: domainStrings(domainRows),
      hasAvatar: !!expert.avatarVideoUrl,
      hasAudio: !!expert.audioIntroUrl,
      hasClonedVoice: !!expert.fishAudioModelId,
    });
  } catch (error) {
    console.error("[experts/[id] GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

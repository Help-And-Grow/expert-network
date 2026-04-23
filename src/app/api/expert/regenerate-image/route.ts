import { type NextRequest, NextResponse } from "next/server";

import { generateProfileImageResilient } from "@/lib/profile-media";
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
      return NextResponse.json({ error: "Expert profile not found" }, { status: 404 });
    }

    const nickName = expert.user.nickName ?? expert.user.name ?? "Expert";

    const profileImage = await generateProfileImageResilient({
      nickName,
      bio: expert.bio ?? "",
      gender: expert.gender ?? undefined,
    });

    if (!profileImage) {
      return NextResponse.json({ error: "Failed to generate image" }, { status: 500 });
    }

    await prisma.expert.update({
      where: { id: expert.id },
      data: { avatarVideoUrl: profileImage },
    });

    return NextResponse.json({ profileImage });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[expert/regenerate-image POST]", message, error);
    return NextResponse.json({ error: "Failed to regenerate image", detail: message }, { status: 500 });
  }
}

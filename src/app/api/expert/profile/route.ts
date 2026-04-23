import { type NextRequest, NextResponse } from "next/server";

import { legacyExpertDomains } from "@/lib/expert-topics";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { isVendorAiStackSiteRequest } from "@/lib/vendor-ai-stack-site";

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const expert = await prisma.expert.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, name: true, nickName: true, email: true, image: true, telegramUsername: true } },
      },
    });

    if (!expert) {
      return NextResponse.json({ error: "Expert profile not found" }, { status: 404 });
    }

    const vendorSite = isVendorAiStackSiteRequest(request);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      avatarVideoUrl: _av,
      audioIntroUrl: _ai,
      documentData: _dd,
      fishAudioModelId: _fm,
      tonMnemonicEnc: _tm,
      servicesOffered,
      ...rest
    } = expert;
    return NextResponse.json({
      ...rest,
      domains: vendorSite ? [] : legacyExpertDomains(),
      servicesOffered: vendorSite ? null : servicesOffered,
      hasAvatar: !!expert.avatarVideoUrl,
      hasAudio: !!expert.audioIntroUrl,
      hasVoiceClone: false,
    });
  } catch (error) {
    console.error("[expert/profile GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const expert = await prisma.expert.findUnique({
      where: { userId },
    });

    if (!expert) {
      return NextResponse.json({ error: "Expert profile not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    const hasLegacyDomainsInput = Array.isArray(body.domains);

    if (typeof body.bio === "string") {
      updateData.bio = body.bio;
    }
    if (typeof body.avatarScript === "string") {
      updateData.avatarScript = body.avatarScript;
    }
    if (Array.isArray(body.servicesOffered)) {
      updateData.servicesOffered = body.servicesOffered;
    }
    if (body.priceOnlineCents === null || (typeof body.priceOnlineCents === "number" && body.priceOnlineCents >= 0)) {
      updateData.priceOnlineCents = body.priceOnlineCents === null ? null : Math.round(body.priceOnlineCents);
    }
    if (body.priceOfflineCents === null || (typeof body.priceOfflineCents === "number" && body.priceOfflineCents >= 0)) {
      updateData.priceOfflineCents = body.priceOfflineCents === null ? null : Math.round(body.priceOfflineCents);
    }
    if (body.weeklySchedule !== undefined) {
      updateData.weeklySchedule = body.weeklySchedule;
    }

    if (Object.keys(updateData).length === 0 && !hasLegacyDomainsInput) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.expert.update({
        where: { id: expert.id },
        data: updateData,
      });
    }

    const updated = await prisma.expert.findUnique({
      where: { id: expert.id },
      include: {
        user: { select: { id: true, name: true, nickName: true, email: true, image: true, telegramUsername: true } },
      },
    });

    const vendorSite = isVendorAiStackSiteRequest(request);
    const { servicesOffered, ...rest } = updated!;
    return NextResponse.json({
      ...rest,
      domains: vendorSite ? [] : legacyExpertDomains(),
      servicesOffered: vendorSite ? null : servicesOffered,
    });
  } catch (error) {
    console.error("[expert/profile PATCH]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

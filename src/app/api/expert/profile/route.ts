import { type NextRequest, NextResponse } from "next/server";

import { normalizeCountryCodes } from "@/lib/expert-countries";
import { embedExpertProfile } from "@/lib/expert-search-embeddings";
import { resolveExpertSearchRegion } from "@/lib/expert-search-region";
import { legacyExpertDomains } from "@/lib/expert-topics";
import { emitExpertProfileChanged } from "@/lib/inngest/emit";
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
        user: {
          select: {
            id: true,
            name: true,
            nickName: true,
            email: true,
            image: true,
            telegramUsername: true,
          },
        },
      },
    });

    if (!expert) {
      return NextResponse.json(
        { error: "Expert profile not found" },
        { status: 404 },
      );
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
      countries: rawCountries,
      ...rest
    } = expert;
    return NextResponse.json({
      ...rest,
      domains: vendorSite ? [] : legacyExpertDomains(),
      servicesOffered: vendorSite ? null : servicesOffered,
      countries: normalizeCountryCodes(rawCountries),
      hasAvatar: !!expert.avatarVideoUrl,
      hasAudio: !!expert.audioIntroUrl,
      hasVoiceClone: false,
    });
  } catch (error) {
    console.error("[expert/profile GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
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
      return NextResponse.json(
        { error: "Expert profile not found" },
        { status: 404 },
      );
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
    if (
      body.priceOnlineCents === null ||
      (typeof body.priceOnlineCents === "number" && body.priceOnlineCents >= 0)
    ) {
      updateData.priceOnlineCents =
        body.priceOnlineCents === null
          ? null
          : Math.round(body.priceOnlineCents);
    }
    if (
      body.priceOfflineCents === null ||
      (typeof body.priceOfflineCents === "number" &&
        body.priceOfflineCents >= 0)
    ) {
      updateData.priceOfflineCents =
        body.priceOfflineCents === null
          ? null
          : Math.round(body.priceOfflineCents);
    }
    if (body.weeklySchedule !== undefined) {
      updateData.weeklySchedule = body.weeklySchedule;
    }
    if (body.countries !== undefined) {
      updateData.countries = normalizeCountryCodes(body.countries);
    }

    if (Object.keys(updateData).length === 0 && !hasLegacyDomainsInput) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
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
        user: {
          select: {
            id: true,
            name: true,
            nickName: true,
            email: true,
            image: true,
            telegramUsername: true,
          },
        },
      },
    });

    if (updated?.isPublished) {
      const region = resolveExpertSearchRegion(request);
      emitExpertProfileChanged(updated.id, { region, reason: "profile" })
        .then(async (sent) => {
          if (!sent) {
            await embedExpertProfile(updated.id, { region });
          }
        })
        .catch((err) => {
          console.warn("[expert/profile PATCH] embedding refresh failed:", err);
        });
    }

    const vendorSite = isVendorAiStackSiteRequest(request);
    const { servicesOffered, countries: rawCountries, ...rest } = updated!;
    return NextResponse.json({
      ...rest,
      domains: vendorSite ? [] : legacyExpertDomains(),
      servicesOffered: vendorSite ? null : servicesOffered,
      countries: normalizeCountryCodes(rawCountries),
    });
  } catch (error) {
    console.error("[expert/profile PATCH]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

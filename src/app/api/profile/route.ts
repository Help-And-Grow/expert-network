import { type NextRequest, NextResponse } from "next/server";

import { normalizeCountryCodes } from "@/lib/expert-countries";
import { legacyExpertDomains } from "@/lib/expert-topics";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { isVendorAiStackSiteRequest } from "@/lib/vendor-ai-stack-site";

export async function GET(request: NextRequest) {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      nickName: true,
      image: true,
      email: true,
      role: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const expert = await prisma.expert.findUnique({
    where: { userId },
  });

  const vendorSite = isVendorAiStackSiteRequest(request);
  const expertData = expert
    ? {
        id: expert.id,
        domains: vendorSite ? [] : legacyExpertDomains(),
        sessionType: expert.sessionType,
        bio: expert.bio,
        servicesOffered: vendorSite ? null : expert.servicesOffered,
        countries: normalizeCountryCodes(expert.countries),
        isVerified: expert.isVerified,
        avgRating: expert.avgRating,
        reviewCount: expert.reviewCount,
        linkedIn: expert.linkedIn,
        website: expert.website,
        twitter: expert.twitter,
        substack: expert.substack,
        instagram: expert.instagram,
        xiaohongshu: expert.xiaohongshu,
        hasAvatar: !!expert.avatarVideoUrl,
        hasAudio: !!expert.audioIntroUrl,
        avatarScript: expert.avatarScript,
        documentName: expert.documentName,
        priceOnlineCents: expert.priceOnlineCents,
        priceOfflineCents: expert.priceOfflineCents,
        currency: expert.currency,
        weeklySchedule: expert.weeklySchedule,
        onboardingStep: expert.onboardingStep,
        isPublished: expert.isPublished,
        stripeAccountId: expert.stripeAccountId,
        stripeAccountStatus: expert.stripeAccountStatus,
      }
    : null;

  return NextResponse.json({
    user,
    expert: expertData,
  });
}

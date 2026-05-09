import { type NextRequest, NextResponse } from "next/server";
import type { SessionType } from "@/generated/prisma/client";
import { absoluteAppUrl } from "@/lib/app-origin";
import {
  expertCountriesSearchText,
  normalizeCountryCodes,
} from "@/lib/expert-countries";
import {
  buildExpertSearchText,
  legacyExpertDomains,
  matchesExpertTopics,
} from "@/lib/expert-topics";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { isVendorAiStackSiteRequest } from "@/lib/vendor-ai-stack-site";

export const dynamic = "force-dynamic";

const AUTH_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: AUTH_HEADERS });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || undefined;
    const domain = searchParams.get("domain") || undefined;
    const sessionType = searchParams.get("sessionType") as SessionType | null;
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10));
    const requestedTopics = domain
      ? domain.split(",").map((d) => d.trim()).filter(Boolean)
      : [];

    const where: Record<string, unknown> = { isPublished: true };

    if (sessionType && ["ONLINE", "OFFLINE", "BOTH"].includes(sessionType)) {
      where.sessionType = { in: [sessionType, "BOTH"] };
    }

    const experts = await prisma.expert.findMany({
      where,
      include: {
        user: { select: { name: true, nickName: true, image: true } },
      },
      orderBy: [{ avgRating: "desc" }, { reviewCount: "desc" }],
    });

    const filteredExperts = experts
      .filter((expert) =>
        matchesExpertTopics(
          {
            name: expert.user.name,
            nickName: expert.user.nickName,
            bio: expert.bio,
            servicesOffered: expert.servicesOffered,
          },
          requestedTopics,
        ),
      )
      .filter((expert) => {
        if (!query) return true;
        const lower = query.toLowerCase();
        const codes = normalizeCountryCodes(expert.countries);
        const haystack =
          buildExpertSearchText({
            name: expert.user.name,
            nickName: expert.user.nickName,
            bio: expert.bio,
            servicesOffered: expert.servicesOffered,
          }) +
          " " +
          expertCountriesSearchText(codes);
        return haystack.includes(lower);
      })
      .slice(0, limit);

    const vendorSite = isVendorAiStackSiteRequest(request);
    const results = filteredExperts.map((e) => ({
      id: e.id,
      name: e.user.nickName || e.user.name || "Expert",
      image: e.user.image,
      bio: e.bio?.slice(0, 300) || "",
      domains: vendorSite ? [] : legacyExpertDomains(),
      countries: normalizeCountryCodes(e.countries),
      sessionType: e.sessionType,
      rating: e.avgRating,
      reviewCount: e.reviewCount,
      priceOnline: e.priceOnlineCents ? `${e.currency} ${(e.priceOnlineCents / 100).toFixed(2)}` : null,
      priceOffline: e.priceOfflineCents ? `${e.currency} ${(e.priceOfflineCents / 100).toFixed(2)}` : null,
      profileUrl: absoluteAppUrl(`/experts/${e.id}`, request),
    }));

    return NextResponse.json({ experts: results, total: results.length });
  } catch (error: unknown) {
    console.error("[v1/experts GET]", error);
    const prismaCode =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    return NextResponse.json(
      { error: "Internal server error", ...(prismaCode ? { prismaCode } : {}) },
      { status: 500 },
    );
  }
}

import { type NextRequest, NextResponse } from "next/server";
import type { SessionType } from "@/generated/prisma/client";
import { absoluteAppUrl } from "@/lib/app-origin";
import { domainStrings } from "@/lib/domains";
import { prisma } from "@/lib/prisma";
import { isVendorAiStackSiteRequest } from "@/lib/vendor-ai-stack-site";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || undefined;
    const domain = searchParams.get("domain") || undefined;
    const sessionType = searchParams.get("sessionType") as SessionType | null;
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10));

    const where: Record<string, unknown> = { isPublished: true };

    if (domain) {
      const domains = domain.split(",").map((d) => d.trim()).filter(Boolean);
      if (domains.length > 0) {
        where.domains = { some: { domain: { in: domains } } };
      }
    }

    if (sessionType && ["ONLINE", "OFFLINE", "BOTH"].includes(sessionType)) {
      where.sessionType = { in: [sessionType, "BOTH"] };
    }

    if (query) {
      where.OR = [
        { bio: { contains: query, mode: "insensitive" } },
        { user: { OR: [
          { name: { contains: query, mode: "insensitive" } },
          { nickName: { contains: query, mode: "insensitive" } },
        ]}},
      ];
    }

    const experts = await prisma.expert.findMany({
      where,
      include: {
        user: { select: { name: true, nickName: true, image: true } },
        domains: true,
      },
      orderBy: [{ avgRating: "desc" }, { reviewCount: "desc" }],
      take: limit,
    });

    const vendorSite = isVendorAiStackSiteRequest(request);
    const results = experts.map((e) => ({
      id: e.id,
      name: e.user.nickName || e.user.name || "Expert",
      image: e.user.image,
      bio: e.bio?.slice(0, 300) || "",
      domains: vendorSite ? [] : domainStrings(e.domains),
      sessionType: e.sessionType,
      rating: e.avgRating,
      reviewCount: e.reviewCount,
      priceOnline: e.priceOnlineCents ? `${e.currency} ${(e.priceOnlineCents / 100).toFixed(2)}` : null,
      priceOffline: e.priceOfflineCents ? `${e.currency} ${(e.priceOfflineCents / 100).toFixed(2)}` : null,
      profileUrl: absoluteAppUrl(`/experts/${e.id}`, request),
    }));

    return NextResponse.json({ experts: results, total: results.length });
  } catch (error) {
    console.error("[v1/experts GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

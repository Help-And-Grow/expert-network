import { type NextRequest, NextResponse } from "next/server";
import { absoluteAppUrl } from "@/lib/app-origin";
import {
  buildExpertFocusLabel,
  buildExpertSearchText,
  legacyExpertDomains,
  serviceTitles,
  stringifyServicesOffered,
} from "@/lib/expert-topics";
import { prisma } from "@/lib/prisma";
import { isVendorAiStackSiteRequest } from "@/lib/vendor-ai-stack-site";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();

    if (!query) {
      return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
    }

    const experts = await prisma.expert.findMany({
      where: { isPublished: true },
      include: {
        user: { select: { name: true, nickName: true } },
      },
      orderBy: [{ avgRating: "desc" }],
      take: 50,
    });

    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    const scored = experts
      .map((e) => {
        let score = 0;
        const searchText = buildExpertSearchText({
          name: e.user.name,
          nickName: e.user.nickName,
          bio: e.bio,
          servicesOffered: e.servicesOffered,
        });
        const bioText = (e.bio || "").toLowerCase();
        const servicesText = stringifyServicesOffered(e.servicesOffered).toLowerCase();
        const matchedServices: string[] = [];

        for (const word of queryWords) {
          if (servicesText.includes(word)) {
            score += 3;
            serviceTitles(e.servicesOffered).forEach((service) => {
              if (service.toLowerCase().includes(word)) matchedServices.push(service);
            });
          }
          if (bioText.includes(word)) score += 2;
          if (searchText.includes(word)) score += 1;
        }

        if (e.avgRating && e.avgRating > 0) score += e.avgRating;

        return { expert: e, score, matchedServices: Array.from(new Set(matchedServices)) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const vendorSite = isVendorAiStackSiteRequest(request);
    const recommendations = scored.map((s) => ({
      id: s.expert.id,
      name: s.expert.user.nickName || s.expert.user.name || "Expert",
      domains: vendorSite ? [] : legacyExpertDomains(),
      rating: s.expert.avgRating,
      reason: vendorSite
        ? "Relevant based on your search."
        : s.matchedServices.length > 0
          ? `Matched services: ${s.matchedServices.join(", ")}`
          : `Relevant based on ${buildExpertFocusLabel(s.expert) ?? "bio and services"}`,
      profileUrl: absoluteAppUrl(`/experts/${s.expert.id}`, request),
    }));

    if (recommendations.length === 0) {
      return NextResponse.json({
        query,
        recommendations: [],
        message: "No matches found. Try broader terms like 'fundraising', 'marketing strategy', or 'hiring'.",
      });
    }

    return NextResponse.json({ query, recommendations, total: recommendations.length });
  } catch (error) {
    console.error("[v1/match GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

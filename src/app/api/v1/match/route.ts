import { type NextRequest, NextResponse } from "next/server";
import { absoluteAppUrl } from "@/lib/app-origin";
import { domainStrings } from "@/lib/domains";
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
        domains: true,
      },
      orderBy: [{ avgRating: "desc" }],
      take: 50,
    });

    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    const scored = experts
      .map((e) => {
        let score = 0;
        const domainText = domainStrings(e.domains).join(" ").toLowerCase();
        const bioText = (e.bio || "").toLowerCase();
        const services = JSON.stringify(e.servicesOffered ?? []).toLowerCase();
        const matchedDomains: string[] = [];

        for (const word of queryWords) {
          if (domainText.includes(word)) {
            score += 3;
            domainStrings(e.domains).forEach((d) => {
              if (d.toLowerCase().includes(word)) matchedDomains.push(d);
            });
          }
          if (bioText.includes(word)) score += 2;
          if (services.includes(word)) score += 1;
        }

        if (e.avgRating && e.avgRating > 0) score += e.avgRating;

        return { expert: e, score, matchedDomains: Array.from(new Set(matchedDomains)) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const vendorSite = isVendorAiStackSiteRequest(request);
    const recommendations = scored.map((s) => ({
      id: s.expert.id,
      name: s.expert.user.nickName || s.expert.user.name || "Expert",
      domains: vendorSite ? [] : domainStrings(s.expert.domains),
      rating: s.expert.avgRating,
      reason: vendorSite
        ? "Relevant based on your search."
        : s.matchedDomains.length > 0
          ? `Matched domains: ${s.matchedDomains.join(", ")}`
          : "Relevant based on bio/experience",
      profileUrl: absoluteAppUrl(`/experts/${s.expert.id}`, request),
    }));

    if (recommendations.length === 0) {
      return NextResponse.json({
        query,
        recommendations: [],
        message: "No matches found. Try broader terms like 'marketing', 'funding', 'law', or 'headhunter'.",
      });
    }

    return NextResponse.json({ query, recommendations, total: recommendations.length });
  } catch (error) {
    console.error("[v1/match GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { absoluteAppUrl } from "@/lib/app-origin";
import {
  detectCountriesInQuery,
  expertCountriesSearchText,
  normalizeCountryCodes,
} from "@/lib/expert-countries";
import {
  buildExpertFocusLabel,
  buildExpertSearchText,
  legacyExpertDomains,
  serviceTitles,
  stringifyServicesOffered,
} from "@/lib/expert-topics";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { isWeChatOriginatedRequest } from "@/lib/request-origin";
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
    const query = searchParams.get("q")?.trim();

    if (!query) {
      return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
    }

    // Defense-in-depth: WeChat traffic sees only FREE + ONLINE-capable experts.
    // See src/app/api/v1/experts/route.ts for the FREE + online-only rationale.
    const experts = await prisma.expert.findMany({
      where: {
        isPublished: true,
        ...(isWeChatOriginatedRequest(request)
          ? {
              priceOnlineCents: 0,
              sessionType: { in: ["ONLINE", "BOTH"] as SessionType[] },
            }
          : {}),
      },
      include: {
        user: { select: { name: true, nickName: true } },
      },
      orderBy: [{ avgRating: "desc" }],
      take: 50,
    });

    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const detectedCountries = detectCountriesInQuery(query);

    // First-round country bias: when the inquiry mentions a country we
    // recognise, restrict the candidate pool to experts who marked that
    // country as a focus. Falls through to the full pool when no expert
    // claims the country yet, otherwise we'd silently return zero hits.
    const candidatePool = detectedCountries.length
      ? (() => {
          const filtered = experts.filter((e) =>
            normalizeCountryCodes(e.countries).some((c) =>
              detectedCountries.includes(c),
            ),
          );
          return filtered.length > 0 ? filtered : experts;
        })()
      : experts;

    const scored = candidatePool
      .map((e) => {
        let score = 0;
        const codes = normalizeCountryCodes(e.countries);
        const searchText =
          buildExpertSearchText({
            name: e.user.name,
            nickName: e.user.nickName,
            bio: e.bio,
            servicesOffered: e.servicesOffered,
          }) +
          " " +
          expertCountriesSearchText(codes);
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

        // Strong boost when the expert claims a detected country —
        // ensures country-tagged experts surface even when the user's
        // other keywords don't match the bio.
        if (detectedCountries.length && codes.some((c) => detectedCountries.includes(c))) {
          score += 4;
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

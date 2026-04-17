import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { domainStrings } from "@/lib/domains";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { isVendorAiStackSiteRequest } from "@/lib/vendor-ai-stack-site";

export const dynamic = "force-dynamic";

const SORT_OPTIONS = ["reviews", "newest"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

function parseSort(value: unknown): SortOption {
  if (typeof value === "string" && SORT_OPTIONS.includes(value as SortOption)) {
    return value as SortOption;
  }
  return "reviews";
}

function parseSessionType(value: unknown): SessionType | null {
  const valid: SessionType[] = ["ONLINE", "OFFLINE", "BOTH"];
  return typeof value === "string" && valid.includes(value as SessionType)
    ? (value as SessionType)
    : null;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const domainParam = searchParams.get("domain");
    const sessionTypeParam = parseSessionType(searchParams.get("sessionType"));
    const sort = parseSort(searchParams.get("sort"));
    const skip = Math.max(0, parseInt(searchParams.get("skip") ?? "0", 10) || 0);
    const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") ?? "20", 10) || 20));

    const domains = domainParam
      ? domainParam.split(",").map((d) => d.trim()).filter(Boolean)
      : undefined;

    const where = {
      isPublished: true,
      userId: { not: userId },
      ...(domains && domains.length > 0
        ? { domains: { some: { domain: { in: domains } } } }
        : {}),
      ...(sessionTypeParam
        ? sessionTypeParam === "BOTH"
          ? {}
          : { sessionType: { in: [sessionTypeParam, "BOTH" as SessionType] } }
        : {}),
    };

    const orderBy =
      sort === "newest"
        ? { createdAt: "desc" as const }
        : [{ reviewCount: "desc" as const }, { avgRating: "desc" as const }];

    const [experts, total] = await Promise.all([
      prisma.expert.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          domains: true,
          user: {
            select: {
              id: true,
              name: true,
              nickName: true,
              image: true,
            },
          },
        },
      }),
      prisma.expert.count({ where }),
    ]);

    const vendorSite = isVendorAiStackSiteRequest(request);
    const result = experts.map((e) => {
      const { domains: domainRows, servicesOffered, ...rest } = e;
      return {
        ...rest,
        domains: vendorSite ? [] : domainStrings(domainRows),
        servicesOffered: vendorSite ? null : servicesOffered,
      };
    });

    return NextResponse.json({
      experts: result,
      total,
      skip,
      take,
    });
  } catch (error) {
    console.error("[experts GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

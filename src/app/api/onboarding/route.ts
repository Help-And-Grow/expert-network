import { type NextRequest, NextResponse } from "next/server";

import type { OnboardingStep, SessionType } from "@/generated/prisma/client";
import { normalizeCountryCodes } from "@/lib/expert-countries";
import { legacyExpertDomains } from "@/lib/expert-topics";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

const SOCIAL_LINK_KEYS = [
  "linkedIn",
  "website",
  "twitter",
  "substack",
  "instagram",
  "xiaohongshu",
] as const;

type SocialLinks = Partial<
  Record<(typeof SOCIAL_LINK_KEYS)[number], string>
>;

function parseOnboardingStep(value: unknown): OnboardingStep | null {
  const valid: OnboardingStep[] = [
    "SOCIAL_LINKS",
    "DOMAINS",
    "SESSION_PREFS",
    "AI_GENERATION",
    "PREVIEW",
    "PUBLISHED",
  ];
  return typeof value === "string" && valid.includes(value as OnboardingStep)
    ? (value as OnboardingStep)
    : null;
}

function parseSessionType(value: unknown): SessionType | null {
  const valid: SessionType[] = ["ONLINE", "OFFLINE", "BOTH"];
  return typeof value === "string" && valid.includes(value as SessionType)
    ? (value as SessionType)
    : null;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }
    const hasLegacyDomainsInput = Array.isArray(body.domains);

    const socialLinks: SocialLinks = {};
    for (const key of SOCIAL_LINK_KEYS) {
      if (body[key] !== undefined) {
        socialLinks[key] =
          typeof body[key] === "string" ? body[key] : String(body[key] ?? "");
      }
    }
    const sessionType = parseSessionType(body.sessionType);
    const onboardingStep = parseOnboardingStep(body.onboardingStep);
    const bio =
      typeof body.bio === "string" ? body.bio : undefined;
    const gender =
      typeof body.gender === "string" && ["male", "female", "other"].includes(body.gender)
        ? body.gender
        : undefined;

    const priceOnlineCents =
      typeof body.priceOnlineCents === "number" && body.priceOnlineCents >= 0
        ? Math.round(body.priceOnlineCents)
        : undefined;
    const priceOfflineCents =
      typeof body.priceOfflineCents === "number" && body.priceOfflineCents >= 0
        ? Math.round(body.priceOfflineCents)
        : undefined;

    const weeklySchedule =
      body.weeklySchedule && typeof body.weeklySchedule === "object" && !Array.isArray(body.weeklySchedule)
        ? body.weeklySchedule
        : undefined;

    // `countries` is multi-select; treat an explicit empty array as "user
    // cleared their selection" — that's why we check for the key, not for
    // a non-empty value.
    const countries =
      body.countries !== undefined ? normalizeCountryCodes(body.countries) : undefined;

    const updateData: Record<string, unknown> = {};
    if (Object.keys(socialLinks).length > 0) Object.assign(updateData, socialLinks);
    if (sessionType !== null) updateData.sessionType = sessionType;
    if (onboardingStep !== null) updateData.onboardingStep = onboardingStep;
    if (bio !== undefined) updateData.bio = bio;
    if (gender !== undefined) updateData.gender = gender;
    if (priceOnlineCents !== undefined) updateData.priceOnlineCents = priceOnlineCents;
    if (priceOfflineCents !== undefined) updateData.priceOfflineCents = priceOfflineCents;
    if (weeklySchedule !== undefined) updateData.weeklySchedule = weeklySchedule;
    if (countries !== undefined) updateData.countries = countries;

    if (Object.keys(updateData).length === 0 && !hasLegacyDomainsInput) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    let expert = await prisma.expert.findUnique({
      where: { userId },
    });

    if (!expert) {
      expert = await prisma.expert.create({
        data: {
          userId,
          ...updateData,
        } as Parameters<typeof prisma.expert.create>[0]["data"],
      });
    } else {
      if (Object.keys(updateData).length > 0) {
        expert = await prisma.expert.update({
          where: { id: expert.id },
          data: updateData,
        });
      }
    }

    const result = await prisma.expert.findUnique({
      where: { id: expert.id },
    });

    return NextResponse.json({ ...result!, domains: legacyExpertDomains() });
  } catch (error) {
    console.error("[onboarding POST]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
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
      return NextResponse.json({
        expert: null,
        onboardingStep: "SOCIAL_LINKS",
        isPublished: false,
      });
    }

    return NextResponse.json({
      expert: { ...expert, domains: legacyExpertDomains() },
      onboardingStep: expert.onboardingStep,
      isPublished: expert.isPublished,
    });
  } catch (error) {
    console.error("[onboarding GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

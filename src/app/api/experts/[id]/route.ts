import { type NextRequest, NextResponse } from "next/server";

import type { ExperienceCapabilities } from "@expert-network/shared-api";

import { legacyExpertDomains } from "@/lib/expert-topics";
import { supportsPayNowForCurrency } from "@/lib/paynow";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";
import { isVendorAiStackSiteRequest } from "@/lib/vendor-ai-stack-site";

export const dynamic = "force-dynamic";

function buildExperienceCapabilities(origin: string, expertId: string, hasAudio: boolean): ExperienceCapabilities {
  const publicProfilePath = `/experts/${expertId}?from=wechat`;
  return {
    voiceIntroAvailable: hasAudio,
    voiceConsult: {
      enabled: true,
      freeReplyLimit: 5,
      groupedDrafts: true,
      replyStyle: "single concise expert voice reply under 60 seconds",
    },
    realtimeVoice: {
      enabled: true,
      availableNow: false,
      premiumOnly: true,
      durationSeconds: 180,
    },
    web: {
      publicProfileUrl: `${origin}${publicProfilePath}`,
      loginFirstProfileUrl: `${origin}/auth/signin?callbackUrl=${encodeURIComponent(publicProfilePath)}`,
    },
  };
}

function buildPaymentCapabilities(currency: string | null | undefined) {
  const payNowAvailable = supportsPayNowForCurrency(currency);
  const stripeCheckoutAvailable = Boolean(process.env.STRIPE_SECRET_KEY?.trim());

  const preferredWebPaymentMethod = payNowAvailable
    ? "paynow"
    : stripeCheckoutAvailable
      ? "stripe_checkout"
      : null;

  return {
    payNowAvailable,
    stripeCheckoutAvailable,
    preferredWebPaymentMethod,
    preferredWebDepositMethod: preferredWebPaymentMethod,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "Expert ID is required" },
        { status: 400 }
      );
    }

    const expert = await prisma.expert.findUnique({
      where: {
        id,
        isPublished: true,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            nickName: true,
            image: true,
          },
        },
        reviews: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            founder: {
              select: {
                id: true,
                name: true,
                nickName: true,
                image: true,
              },
            },
          },
        },
      },
    });

    if (!expert) {
      return NextResponse.json(
        { error: "Expert not found" },
        { status: 404 }
      );
    }

    // Calculate stats: Learned from XX+ coaches, helped YY+ players
    const [learnedFromCount, offeredHelpCount] = await Promise.all([
      prisma.booking.groupBy({
        by: ["expertId"],
        where: {
          founderId: expert.userId,
          status: "COMPLETED",
        },
      }).then((groups) => groups.length),
      prisma.booking.groupBy({
        by: ["founderId"],
        where: {
          expertId: expert.id,
          status: "COMPLETED",
        },
      }).then((groups) => groups.length),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const viewerUserId = await resolveUserId(request).catch(() => null);
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      documentData: _dd,
      avatarVideoUrl: _av,
      audioIntroUrl: _ai,
      fishAudioModelId: _fm,
      linkedIn: _li,
      website: _ws,
      twitter: _tw,
      substack: _ss,
      instagram: _ig,
      xiaohongshu: _xh,
      servicesOffered,
      ...rest
    } = expert;
    /* eslint-enable @typescript-eslint/no-unused-vars */
    const origin = new URL(request.url).origin;
    const experienceCapabilities = buildExperienceCapabilities(
      origin,
      expert.id,
      !!expert.audioIntroUrl,
    );
    const paymentCapabilities = buildPaymentCapabilities(expert.currency);

    const vendorSite = isVendorAiStackSiteRequest(request);
    const payload = {
      ...rest,
      domains: vendorSite ? [] : legacyExpertDomains(),
      servicesOffered: vendorSite ? null : servicesOffered,
      hasAvatar: !!expert.avatarVideoUrl,
      hasAudio: !!expert.audioIntroUrl,
      hasClonedVoice: false,
      /** Voice chat works with clone or built-in default voice */
      hasVoiceChat: true,
      viewerIsOwner: viewerUserId === expert.user.id,
      experienceCapabilities,
      paymentCapabilities,
      learnedFromCount,
      offeredHelpCount,
    };

    return NextResponse.json(payload);

  } catch (error) {
    console.error("[experts/[id] GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

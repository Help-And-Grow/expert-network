import { type NextRequest, NextResponse } from "next/server";

import { storeReviewEvent } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

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

    const bookingId =
      typeof body.bookingId === "string" ? body.bookingId.trim() : null;
    const rating =
      typeof body.rating === "number" ? body.rating : 5;
    const comment =
      typeof body.comment === "string" ? body.comment : undefined;

    if (!bookingId) {
      return NextResponse.json(
        { error: "bookingId is required" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      return NextResponse.json(
        { error: "rating must be an integer between 0 and 5" },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { expert: true },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 }
      );
    }
    if (booking.founderId !== userId) {
      return NextResponse.json(
        { error: "Forbidden: only the session booker can send an appreciation" },
        { status: 403 }
      );
    }
    if (booking.status !== "COMPLETED") {
      return NextResponse.json(
        { error: "Can only appreciate completed bookings" },
        { status: 400 }
      );
    }

    const existingReview = await prisma.review.findUnique({
      where: { bookingId },
    });
    if (existingReview) {
      return NextResponse.json(
        { error: "This booking has already been appreciated" },
        { status: 400 }
      );
    }

    const [review, agg] = await prisma.$transaction([
      prisma.review.create({
        data: {
          bookingId,
          expertId: booking.expertId,
          founderId: userId,
          rating,
          comment: comment ?? null,
        },
        include: { founder: true, expert: { include: { user: true } } },
      }),
      prisma.review.aggregate({
        where: { expertId: booking.expertId },
        _avg: { rating: true },
        _count: true,
      }),
    ]);

    await prisma.expert.update({
      where: { id: booking.expertId },
      data: {
        avgRating: agg._avg.rating ?? 0,
        reviewCount: agg._count,
      },
    });

    storeReviewEvent({
      expertId: booking.expertId,
      founderName: review.founder.nickName ?? review.founder.name ?? "Client",
      rating,
      comment,
    }).catch(() => {});

    return NextResponse.json(review);
  } catch (error) {
    console.error("[reviews POST]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : null;
    const expertSuggestion = typeof body.expertSuggestion === "string" ? body.expertSuggestion.trim() : null;

    if (!bookingId) {
      return NextResponse.json({ error: "bookingId is required" }, { status: 400 });
    }
    if (!expertSuggestion) {
      return NextResponse.json({ error: "Guidance is required" }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { expert: true, review: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (booking.expert.userId !== userId) {
      return NextResponse.json(
        { error: "Forbidden: only the coach can add follow-up" },
        { status: 403 }
      );
    }
    if (booking.status !== "COMPLETED") {
      return NextResponse.json(
        { error: "Can only add guidance for completed bookings" },
        { status: 400 }
      );
    }

    if (booking.review) {
      const updated = await prisma.review.update({
        where: { id: booking.review.id },
        data: { expertSuggestion, suggestionAt: new Date() },
      });
      return NextResponse.json(updated);
    }

    const review = await prisma.review.create({
      data: {
        bookingId,
        expertId: booking.expertId,
        founderId: booking.founderId,
        rating: 0,
        expertSuggestion,
        suggestionAt: new Date(),
      },
    });
    return NextResponse.json(review);
  } catch (error) {
    console.error("[reviews PATCH]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const expertId = searchParams.get("expertId");
    const skip = Math.max(0, parseInt(searchParams.get("skip") ?? "0", 10) || 0);
    const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") ?? "20", 10) || 20));

    if (!expertId) {
      return NextResponse.json(
        { error: "expertId query param is required" },
        { status: 400 }
      );
    }

    const where = { 
      expertId, 
      OR: [
        { rating: { gt: 0 } },
        { comment: { not: null } }
      ]
    };
    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
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
      }),
      prisma.review.count({ where }),
    ]);

    return NextResponse.json({ reviews, total, skip, take });
  } catch (error) {
    console.error("[reviews GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

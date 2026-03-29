import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure } from "../init";

export const reviewProcedures = {
  createReview: protectedProcedure
    .input(z.object({
      bookingId: z.string().min(1),
      rating: z.number().int().min(1).max(5),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { bookingId, rating, comment } = input;

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
      });

      if (!booking || booking.founderId !== ctx.userId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found or not owned by you",
        });
      }

      if (booking.status !== "COMPLETED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only completed sessions can be reviewed",
        });
      }

      // Create review and update expert stats
      const [review] = await prisma.$transaction([
        prisma.review.create({
          data: {
            bookingId,
            expertId: booking.expertId,
            founderId: ctx.userId,
            rating,
            comment,
          },
        }),
        prisma.expert.update({
          where: { id: booking.expertId },
          data: {
            reviewCount: { increment: 1 },
            // Simplified avgRating update for legacy systems, usually calculated on-read in large systems
            // but we'll update it here for small scale completeness
          },
        }),
      ]);

      // Recalculate average rating
      const expertReviews = await prisma.review.findMany({
        where: { expertId: booking.expertId },
        select: { rating: true },
      });
      
      const newAvg = expertReviews.reduce((sum, r) => sum + r.rating, 0) / expertReviews.length;

      await prisma.expert.update({
        where: { id: booking.expertId },
        data: { avgRating: newAvg },
      });

      return review;
    }),

  getReviewsForExpert: publicProcedure
    .input(z.object({
      expertId: z.string().min(1),
      limit: z.number().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const take = input.limit ?? 20;
      const reviews = await prisma.review.findMany({
        where: { expertId: input.expertId },
        take: take + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          founder: {
            select: { id: true, name: true, nickName: true, image: true },
          },
        },
      });

      let nextCursor: typeof input.cursor | undefined = undefined;
      if (reviews.length > take) {
        const nextItem = reviews.pop();
        nextCursor = nextItem!.id;
      }

      return {
        reviews,
        nextCursor,
      };
    }),
};

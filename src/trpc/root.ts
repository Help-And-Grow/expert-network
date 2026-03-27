import { z } from "zod";

import { prisma } from "@/lib/prisma";

import { protectedProcedure, publicProcedure, router } from "./init";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true as const,
    ts: Date.now(),
  })),

  expertPreview: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const expert = await prisma.expert.findFirst({
        where: { id: input.id, isPublished: true },
        select: {
          id: true,
          domains: true,
          bio: true,
          priceOnlineCents: true,
          currency: true,
        },
      });
      return expert;
    }),

  expertsPublished: publicProcedure
    .input(
      z.object({
        take: z.number().min(1).max(50).optional(),
        skip: z.number().min(0).optional(),
      }),
    )
    .query(async ({ input }) => {
      const take = input.take ?? 20;
      const skip = input.skip ?? 0;
      const [experts, total] = await Promise.all([
        prisma.expert.findMany({
          where: { isPublished: true },
          take,
          skip,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            bio: true,
            avgRating: true,
            reviewCount: true,
            priceOnlineCents: true,
            currency: true,
            sessionType: true,
            domains: { select: { domain: true } },
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
        prisma.expert.count({ where: { isPublished: true } }),
      ]);
      return { experts, total, take, skip };
    }),

  bookingsMine: protectedProcedure.query(async ({ ctx }) => {
    return prisma.booking.findMany({
      where: {
        OR: [{ founderId: ctx.userId }, { expert: { userId: ctx.userId } }],
      },
      orderBy: { startTime: "desc" },
      take: 40,
      select: {
        id: true,
        status: true,
        startTime: true,
        endTime: true,
        sessionType: true,
        expertId: true,
        founderId: true,
        paymentStatus: true,
        totalAmountCents: true,
        currency: true,
      },
    });
  }),
});

export type AppRouter = typeof appRouter;

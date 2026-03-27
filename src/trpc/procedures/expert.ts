import { z } from "zod";

import { prisma } from "@/lib/prisma";

import { publicProcedure, protectedProcedure } from "../init";

export const expertProcedures = {
  expertMine: protectedProcedure.query(async ({ ctx }) => {
    return prisma.expert.findUnique({
      where: { userId: ctx.userId },
      select: {
        id: true,
        userId: true,
        bio: true,
        onboardingStep: true,
        isPublished: true,
        isVerified: true,
        priceOnlineCents: true,
        priceOfflineCents: true,
        currency: true,
        sessionType: true,
        mem9SpaceId: true,
        weeklySchedule: true,
        stripeAccountId: true,
        stripeAccountStatus: true,
        domains: { select: { id: true, domain: true } },
        user: {
          select: { id: true, name: true, nickName: true, email: true, image: true },
        },
      },
    });
  }),

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
};

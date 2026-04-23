import { z } from "zod";

import { legacyExpertDomains } from "@/lib/expert-topics";
import { prisma } from "@/lib/prisma";

import { publicProcedure, protectedProcedure } from "../init";

export const expertProcedures = {
  expertMine: protectedProcedure.query(async ({ ctx }) => {
    const expert = await prisma.expert.findUnique({
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
        user: {
          select: { id: true, name: true, nickName: true, email: true, image: true },
        },
      },
    });
    return expert
      ? {
          ...expert,
          domains: legacyExpertDomains(),
        }
      : null;
  }),

  expertPreview: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const expert = await prisma.expert.findFirst({
        where: { id: input.id, isPublished: true },
        select: {
          id: true,
          bio: true,
          priceOnlineCents: true,
          currency: true,
        },
      });
      return expert
        ? {
            ...expert,
            domains: legacyExpertDomains(),
          }
        : null;
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
      return {
        experts: experts.map((expert) => ({
          ...expert,
          domains: legacyExpertDomains(),
        })),
        total,
        take,
        skip,
      };
    }),
};

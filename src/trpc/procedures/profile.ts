import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { protectedProcedure } from "../init";

export const profileProcedures = {
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const userPromise = prisma.user.findUnique({
      where: { id: ctx.userId },
      select: {
        id: true,
        name: true,
        nickName: true,
        image: true,
        email: true,
        role: true,
        tokenBalance: true,
      },
    });

    const expertPromise = prisma.expert.findUnique({
      where: { userId: ctx.userId },
      include: {
        domains: { select: { domain: true, id: true } },
      },
    });

    const [user, expert] = await Promise.all([userPromise, expertPromise]);

    if (!user) {
      throw new Error("User not found");
    }

    return {
      user,
      expert: expert ? {
        ...expert,
        domainNames: expert.domains.map(d => d.domain)
      } : null,
    };
  }),

  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().optional(),
      nickName: z.string().optional(),
      image: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return prisma.user.update({
        where: { id: ctx.userId },
        data: input,
      });
    }),

  updateExpertProfile: protectedProcedure
    .input(z.object({
      bio: z.string().optional(),
      priceOnlineCents: z.number().int().min(0).optional().nullable(),
      priceOfflineCents: z.number().int().min(0).optional().nullable(),
      currency: z.string().optional(),
      sessionType: z.enum(["ONLINE", "OFFLINE", "BOTH"]).optional(),
      linkedIn: z.string().optional().nullable(),
      website: z.string().optional().nullable(),
      twitter: z.string().optional().nullable(),
      substack: z.string().optional().nullable(),
      instagram: z.string().optional().nullable(),
      xiaohongshu: z.string().optional().nullable(),
      servicesOffered: z.array(z.string()).optional(),
      weeklySchedule: z.record(z.any()).optional(), // Using record to avoid top-level any
    }))
    .mutation(async ({ ctx, input }) => {
      const { servicesOffered, weeklySchedule, ...rest } = input;
      return prisma.expert.update({
        where: { userId: ctx.userId },
        data: {
          ...rest,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          servicesOffered: servicesOffered as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          weeklySchedule: weeklySchedule as any,
        },
      });
    }),
};

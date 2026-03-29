import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setExpertDomains, domainStrings } from "@/lib/domains";
import { protectedProcedure } from "../init";

const ONBOARDING_STEPS = ["SOCIAL_LINKS", "DOMAINS", "SESSION_PREFS", "AI_GENERATION", "PREVIEW", "PUBLISHED"] as const;
const SESSION_TYPES = ["ONLINE", "OFFLINE", "BOTH"] as const;

export const onboardingProcedures = {
  getOnboardingExpert: protectedProcedure.query(async ({ ctx }) => {
    const expert = await prisma.expert.findUnique({
      where: { userId: ctx.userId },
      include: { domains: true },
    });

    if (!expert) {
      return {
        expert: null,
        onboardingStep: "SOCIAL_LINKS",
        isPublished: false,
      };
    }

    return {
      expert: {
        ...expert,
        domains: domainStrings(expert.domains),
      },
      onboardingStep: expert.onboardingStep,
      isPublished: expert.isPublished,
    };
  }),

  updateOnboarding: protectedProcedure
    .input(z.object({
      linkedIn: z.string().optional(),
      website: z.string().optional(),
      twitter: z.string().optional(),
      substack: z.string().optional(),
      instagram: z.string().optional(),
      xiaohongshu: z.string().optional(),
      domains: z.array(z.string()).optional(),
      sessionType: z.enum(SESSION_TYPES).optional(),
      onboardingStep: z.enum(ONBOARDING_STEPS).optional(),
      bio: z.string().optional(),
      gender: z.string().optional(),
      priceOnlineCents: z.number().int().min(0).optional(),
      priceOfflineCents: z.number().int().min(0).optional(),
      weeklySchedule: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { domains, ...updateData } = input;

      let expert = await prisma.expert.findUnique({
        where: { userId: ctx.userId },
      });

      if (!expert) {
        expert = await prisma.expert.create({
          data: {
            userId: ctx.userId,
            ...updateData,
          },
        });
      } else {
        if (Object.keys(updateData).length > 0) {
          expert = await prisma.expert.update({
            where: { id: expert.id },
            data: updateData,
          });
        }
      }

      if (domains !== undefined) {
        await setExpertDomains(expert.id, domains);
      }

      const updated = await prisma.expert.findUnique({
        where: { id: expert.id },
        include: { domains: true },
      });

      return {
        ...updated!,
        domains: domainStrings(updated!.domains),
      };
    }),
};

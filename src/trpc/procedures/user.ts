import { prisma } from "@/lib/prisma";

import { protectedProcedure } from "../init";

/** Signed-in user + optional expert row (for dashboard / profile flows). */
export const userProcedures = {
  me: protectedProcedure.query(async ({ ctx }) => {
    return prisma.user.findUnique({
      where: { id: ctx.userId },
      select: {
        id: true,
        name: true,
        nickName: true,
        email: true,
        image: true,
        role: true,
        tokenBalance: true,
        expert: {
          select: {
            id: true,
            bio: true,
            isPublished: true,
            onboardingStep: true,
            priceOnlineCents: true,
            currency: true,
            sessionType: true,
            mem9SpaceId: true,
          },
        },
      },
    });
  }),
};

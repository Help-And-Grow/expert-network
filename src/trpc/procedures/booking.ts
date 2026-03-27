import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

import { protectedProcedure } from "../init";

export const bookingProcedures = {
  bookingById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const booking = await prisma.booking.findFirst({
        where: {
          id: input.id,
          OR: [{ founderId: ctx.userId }, { expert: { userId: ctx.userId } }],
        },
        select: {
          id: true,
          status: true,
          startTime: true,
          endTime: true,
          timezone: true,
          sessionType: true,
          meetingLink: true,
          offlineAddress: true,
          expertId: true,
          founderId: true,
          paymentStatus: true,
          totalAmountCents: true,
          depositAmountCents: true,
          currency: true,
          expert: {
            select: {
              id: true,
              user: {
                select: { id: true, name: true, nickName: true, image: true },
              },
            },
          },
          founder: {
            select: { id: true, name: true, nickName: true, image: true },
          },
          review: {
            select: {
              id: true,
              rating: true,
              comment: true,
            },
          },
        },
      });
      if (!booking) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
      }
      return booking;
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
};

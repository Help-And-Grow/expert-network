import { prisma } from "@/lib/prisma";
import { sendSessionReminder } from "@/lib/telegram-bot";

export type ChargeRemainderCronResult = {
  processed: number;
  charged: number;
  failed: number;
  manualDue: number;
  reminders: number;
  autoCompleted: number;
};

/**
 * Core logic for the Vercel cron route (and future job runners e.g. Inngest).
 * Auto-completes ended sessions and sends Telegram reminders.
 * Remainder charging is retired because bookings now require full payment upfront.
 */
export async function runChargeRemainderCron(): Promise<ChargeRemainderCronResult> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const completed = await prisma.booking.updateMany({
    where: {
      status: "CONFIRMED",
      endTime: { lt: new Date() },
    },
    data: { status: "COMPLETED" },
  });
  if (completed.count > 0) {
    console.log(
      `[charge-remainder-cron] Auto-completed ${completed.count} bookings`,
    );
  }

  const legacyDepositBookings = await prisma.booking.findMany({
    where: {
      paymentStatus: "deposit_paid",
      remainderChargedAt: null,
      endTime: { lt: cutoff },
    },
    select: {
      id: true,
      totalAmountCents: true,
      depositAmountCents: true,
    },
  });

  let charged = 0;
  let failed = 0;
  let manualDue = 0;

  for (const booking of legacyDepositBookings) {
    const remainderCents =
      (booking.totalAmountCents || 0) - (booking.depositAmountCents || 0);

    if (remainderCents <= 0) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: "fully_paid",
          remainderChargedAt: new Date(),
        },
      });
      charged++;
    } else {
      manualDue++;
      console.warn(
        `[charge-remainder-cron] Legacy half-paid booking ${booking.id} still has ${remainderCents} cents unpaid; automatic remainder charging is retired.`,
      );
    }
  }

  const reminderStart = new Date();
  const reminderEnd = new Date(Date.now() + 25 * 60 * 60 * 1000);

  const upcomingBookings = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      paymentStatus: { in: ["fully_paid", "deposit_paid"] },
      startTime: { gte: reminderStart, lte: reminderEnd },
    },
    include: {
      expert: { include: { user: true } },
      founder: true,
    },
  });

  let reminders = 0;
  for (const b of upcomingBookings) {
    const expertName =
      b.expert.user.nickName ?? b.expert.user.name ?? "Expert";

    const founderName = b.founder.nickName ?? b.founder.name ?? "Client";

    sendSessionReminder({
      telegramUsername: b.founder.telegramUsername,
      expertName,
      sessionType: b.sessionType,
      startTime: b.startTime,
    }).catch(() => {});

    sendSessionReminder({
      telegramUsername: b.expert.user.telegramUsername,
      expertName: founderName,
      sessionType: b.sessionType,
      startTime: b.startTime,
    }).catch(() => {});

    reminders++;
  }

  console.log(
    `[charge-remainder-cron] Processed ${legacyDepositBookings.length} legacy bookings: ${charged} normalized, ${failed} failed, ${manualDue} legacy half-paid skipped, ${reminders} reminders sent`,
  );

  return {
    processed: legacyDepositBookings.length,
    charged,
    failed,
    manualDue,
    reminders,
    autoCompleted: completed.count,
  };
}

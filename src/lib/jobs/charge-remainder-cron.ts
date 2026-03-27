import { prisma } from "@/lib/prisma";
import { createPaymentIntent } from "@/lib/stripe";
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
 * Auto-completes ended sessions, charges Stripe remainders, flags manual remainder flows, sends Telegram reminders.
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

  const bookings = await prisma.booking.findMany({
    where: {
      paymentStatus: "deposit_paid",
      remainderChargedAt: null,
      endTime: { lt: cutoff },
    },
  });

  let charged = 0;
  let failed = 0;
  let manualDue = 0;

  for (const booking of bookings) {
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
      continue;
    }

    if (
      booking.paymentMethod === "stripe" &&
      booking.stripeCustomerId &&
      booking.stripePaymentMethodId
    ) {
      try {
        const pi = await createPaymentIntent({
          amount: remainderCents,
          currency: (booking.currency || "sgd").toLowerCase(),
          customer: booking.stripeCustomerId,
          payment_method: booking.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            type: "booking_remainder",
            bookingId: booking.id,
          },
        });

        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            paymentStatus: "fully_paid",
            stripeRemainderPIId: pi.id,
            remainderChargedAt: new Date(),
          },
        });

        charged++;
      } catch (err) {
        console.error(
          `[charge-remainder-cron] Failed for booking ${booking.id}:`,
          err,
        );
        await prisma.booking.update({
          where: { id: booking.id },
          data: { paymentStatus: "failed" },
        });
        failed++;
      }
      continue;
    }

    if (
      booking.paymentMethod === "stripe" ||
      booking.paymentMethod === "ton" ||
      booking.paymentMethod === "telegram_payments"
    ) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { paymentStatus: "remainder_due" },
      });
      manualDue++;
      continue;
    }
  }

  const reminderStart = new Date();
  const reminderEnd = new Date(Date.now() + 25 * 60 * 60 * 1000);

  const upcomingBookings = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      paymentStatus: "deposit_paid",
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
    `[charge-remainder-cron] Processed ${bookings.length} bookings: ${charged} charged, ${failed} failed, ${manualDue} manual due, ${reminders} reminders sent`,
  );

  return {
    processed: bookings.length,
    charged,
    failed,
    manualDue,
    reminders,
    autoCompleted: completed.count,
  };
}

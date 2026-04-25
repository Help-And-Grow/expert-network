import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { triggerBookingEmails } from "@/lib/booking-emails";
import { findParticipantBookingConflict } from "@/lib/booking-utils";
import { creditTokens } from "@/lib/hg-token";
import { storeBookingEvent } from "@/lib/integrations/mem9-lifecycle";
import { generateMeetingLink } from "@/lib/meeting";
import { prisma } from "@/lib/prisma";
import {
  verifyWebhookSignature,
  retrievePaymentIntent,
  getAccountStatus,
  getWebhookSecret,
} from "@/lib/stripe";
import { notifyExpertBooking, notifyFounderBooking } from "@/lib/telegram-bot";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    console.error("[webhooks/stripe] Missing:", {
      hasSignature: !!sig,
      hasSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    });
    return NextResponse.json(
      { error: "Missing stripe signature" },
      { status: 400 }
    );
  }

  let webhookSecret: string;
  try {
    webhookSecret = getWebhookSecret();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[webhooks/stripe] Invalid webhook secret:", message);
    return NextResponse.json(
      { error: "Invalid webhook secret configuration" },
      { status: 500 }
    );
  }

  let event: Record<string, unknown>;
  try {
    const body = await request.text();
    event = await verifyWebhookSignature(body, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[webhooks/stripe] Signature verification failed:", msg);
    console.error("[webhooks/stripe] Secret prefix:", webhookSecret.slice(0, 10) + "...");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const eventType = event.type as string;
  const eventId = event.id as string;
  console.log(`[webhooks/stripe] Processing ${eventType} (${eventId})`);

  try {
    const dataObject = (event.data as { object: Record<string, unknown> })?.object;

    switch (eventType) {
      case "checkout.session.completed": {
        const session = dataObject;
        const sessionMeta = session.metadata as Record<string, string> | undefined;

        if (sessionMeta?.type === "booking_remainder") {
          const bookingId = sessionMeta.bookingId;
          if (bookingId) {
            await prisma.booking.update({
              where: { id: bookingId },
              data: {
                paymentStatus: "fully_paid",
                remainderChargedAt: new Date(),
              },
            });
            console.log(
              `[webhooks/stripe] Booking ${bookingId} remainder paid via checkout`
            );
          }
          break;
        }

        const bookingPaymentType = sessionMeta?.type;
        if (
          bookingPaymentType !== "booking_full_payment" &&
          bookingPaymentType !== "booking_deposit"
        ) {
          break;
        }

        const alreadyExists = await prisma.booking.findFirst({
          where: { stripeCheckoutSessionId: session.id as string },
          select: { id: true },
        });
        if (alreadyExists) {
          console.log(`[webhooks/stripe] Booking already exists for session ${session.id}`);
          break;
        }

        const pi =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent as { id?: string })?.id;

        let paymentMethodId: string | undefined;
        let customerId: string | undefined;
        let piMeta: Record<string, string> = {};

        if (pi) {
          const paymentIntent = await retrievePaymentIntent(pi);
          paymentMethodId =
            typeof paymentIntent.payment_method === "string"
              ? paymentIntent.payment_method
              : undefined;
          customerId =
            typeof paymentIntent.customer === "string"
              ? paymentIntent.customer
              : undefined;
          piMeta = (paymentIntent.metadata as Record<string, string>) ?? {};
        }

        const meta = { ...(sessionMeta ?? {}), ...piMeta };
        const totalPaidCents = parseInt(meta.totalCents || "0", 10);
        const dueNowCents = parseInt(
          meta.dueNowCents || meta.depositCents || meta.totalCents || "0",
          10
        );
        const isLegacyDeposit =
          bookingPaymentType === "booking_deposit" && dueNowCents < totalPaidCents;
        const bookingStart = new Date(meta.startTime!);
        const bookingEnd = new Date(meta.endTime!);

        const conflict = await findParticipantBookingConflict({
          expertId: meta.expertId!,
          founderId: meta.founderId!,
          startTime: bookingStart,
          endTime: bookingEnd,
        });
        if (conflict) {
          console.error(
            `[webhooks/stripe] Paid checkout ${session.id} conflicts with booking ${conflict.id}; not creating confirmed booking.`,
          );
          break;
        }

        const booking = await prisma.booking.create({
          data: {
            expertId: meta.expertId!,
            founderId: meta.founderId!,
            sessionType: (meta.sessionType || "ONLINE") as SessionType,
            startTime: bookingStart,
            endTime: bookingEnd,
            timezone: meta.timezone || "Asia/Singapore",
            meetingLink: (meta.sessionType || "ONLINE") === "ONLINE"
              ? (meta.meetingLink || generateMeetingLink())
              : null,
            offlineAddress: meta.offlineAddress || null,
            status: "CONFIRMED",
            totalAmountCents: totalPaidCents,
            depositAmountCents: dueNowCents,
            currency: meta.currency || "SGD",
            paymentMethod: "stripe",
            paymentStatus: isLegacyDeposit ? "deposit_paid" : "fully_paid",
            stripeCheckoutSessionId: session.id as string,
            stripePaymentIntentId: pi || null,
            stripeCustomerId: customerId || null,
            stripePaymentMethodId: paymentMethodId || null,
            tokenDiscount: parseInt(meta.tokenDiscount || "0", 10) || 0,
            tokensRedeemed: parseInt(meta.tokensRedeemed || "0", 10) || 0,
          },
          include: {
            expert: { include: { user: true } },
            founder: true,
          },
        });

        storeBookingEvent({
          expertId: booking.expertId,
          founderName:
            booking.founder.nickName ?? booking.founder.name ?? "Client",
          sessionType: booking.sessionType,
          startTime: booking.startTime,
          status: booking.status,
        }).catch(() => {});

        triggerBookingEmails(booking);

        if (booking.totalAmountCents && booking.totalAmountCents > 0) {
          creditTokens(booking.founderId, booking.id, booking.totalAmountCents).catch(
            (e) => console.error("[webhooks/stripe] token credit error:", e)
          );
        }

        const paymentLabel = `${booking.currency} ${((booking.depositAmountCents || 0) / 100).toFixed(2)}`;

        notifyExpertBooking({
          expertTelegramId: booking.expert.user.telegramId,
          expertTelegramUsername: booking.expert.user.telegramUsername,
          founderName: booking.founder.nickName ?? booking.founder.name ?? "Client",
          sessionType: booking.sessionType,
          startTime: booking.startTime,
          depositAmount: paymentLabel,
          timezone: booking.timezone,
        }).catch(() => {});

        notifyFounderBooking({
          founderTelegramId: booking.founder.telegramId,
          founderTelegramUsername: booking.founder.telegramUsername,
          expertName: booking.expert.user.nickName ?? booking.expert.user.name ?? "Expert",
          sessionType: booking.sessionType,
          startTime: booking.startTime,
          depositAmount: paymentLabel,
          timezone: booking.timezone,
        }).catch(() => {});

        console.log(
          `[webhooks/stripe] Booking ${booking.id} created (${booking.paymentStatus})`
        );
        break;
      }

      case "payment_intent.succeeded": {
        const piMeta = dataObject.metadata as Record<string, string> | undefined;
        if (piMeta?.type !== "booking_remainder") break;

        const bookingId = piMeta.bookingId;
        if (bookingId) {
          await prisma.booking.update({
            where: { id: bookingId },
            data: {
              paymentStatus: "fully_paid",
              stripeRemainderPIId: dataObject.id as string,
              remainderChargedAt: new Date(),
            },
          });
          console.log(
            `[webhooks/stripe] Booking ${bookingId} remainder paid`
          );
        }
        break;
      }

      case "account.updated": {
        const acct = dataObject as {
          id?: string;
          charges_enabled?: boolean;
          payouts_enabled?: boolean;
          details_submitted?: boolean;
          requirements?: {
            currently_due: string[];
            eventually_due: string[];
            disabled_reason: string | null;
          };
        };

        if (acct.id) {
          const status = getAccountStatus({
            id: acct.id as string,
            charges_enabled: !!acct.charges_enabled,
            payouts_enabled: !!acct.payouts_enabled,
            details_submitted: !!acct.details_submitted,
            requirements: acct.requirements,
          });

          await prisma.expert.updateMany({
            where: { stripeAccountId: acct.id as string },
            data: { stripeAccountStatus: status },
          });

          console.log(
            `[webhooks/stripe] Connected account ${acct.id} status → ${status}`
          );
        }
        break;
      }

      default:
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[webhooks/stripe] Processing error for ${eventType} (${eventId}):`, message);
    if (stack) console.error("[webhooks/stripe] Stack:", stack);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }

  console.log(`[webhooks/stripe] Successfully processed ${eventType} (${eventId})`);
  return NextResponse.json({ received: true });
}

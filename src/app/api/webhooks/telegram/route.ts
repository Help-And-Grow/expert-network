import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { chat } from "@/lib/chat-engine";
import { storeBookingEvent } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";
import { notifyExpertBooking } from "@/lib/telegram-bot";

const APP_URL =
  process.env.NEXTAUTH_URL || "https://expert-network.vercel.app";

async function sendMessage(
  botToken: string,
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      ...extra,
    }),
  });
}

async function sendChatAction(
  botToken: string,
  chatId: number,
  action: string
) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

function webAppButton(label: string, path = "/discover") {
  return { text: label, web_app: { url: `${APP_URL}${path}` } };
}

function buildExpertButtons(
  experts: { expertId: string; name: string; profileUrl: string; bookUrl: string }[]
): Record<string, unknown>[][] {
  return experts.slice(0, 5).map((e) => [
    { text: `View ${e.name}`, web_app: { url: e.profileUrl } },
    { text: `Book ${e.name}`, web_app: { url: e.bookUrl } },
  ]);
}

export async function POST(request: NextRequest) {
  try {
    const update = await request.json();
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      return NextResponse.json({ ok: true });
    }

    // --- Pre-checkout query (payment) ---
    if (update.pre_checkout_query) {
      await fetch(
        `https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pre_checkout_query_id: update.pre_checkout_query.id,
            ok: true,
          }),
        }
      );
      return NextResponse.json({ ok: true });
    }

    // --- Successful payment ---
    const payment = update.message?.successful_payment;
    if (payment) {
      const payload = JSON.parse(payment.invoice_payload);
      const chatId = update.message.chat.id;

      const booking = await prisma.booking.create({
        data: {
          expertId: payload.expertId,
          founderId: payload.founderId,
          sessionType: (payload.sessionType || "ONLINE") as SessionType,
          startTime: new Date(payload.startTime),
          endTime: new Date(payload.endTime),
          timezone: payload.timezone || "Asia/Singapore",
          meetingLink: payload.meetingLink || null,
          status: "CONFIRMED",
          totalAmountCents: payload.totalCents,
          depositAmountCents: payload.depositCents,
          currency: payload.currency || "SGD",
          paymentMethod: "telegram_payments",
          paymentStatus: "deposit_paid",
          stripePaymentIntentId: payment.telegram_payment_charge_id || null,
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

      await sendMessage(
        botToken,
        chatId,
        `✅ *Booking confirmed!*\nYour session with ${booking.expert.user.nickName || booking.expert.user.name || "the expert"} is booked. You'll receive details shortly.`
      );

      const depositLabel = `${booking.currency} ${((booking.depositAmountCents || 0) / 100).toFixed(2)}`;
      notifyExpertBooking({
        expertTelegramId: booking.expert.user.telegramId,
        expertTelegramUsername: booking.expert.user.telegramUsername,
        founderName: booking.founder.nickName ?? booking.founder.name ?? "Client",
        sessionType: booking.sessionType,
        startTime: booking.startTime,
        depositAmount: depositLabel,
        timezone: booking.timezone,
      }).catch(() => {});

      return NextResponse.json({ ok: true });
    }

    // --- Message handling ---
    const message = update.message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;

    // Link telegramId for any message type (text, sticker, etc.)
    const fromUsername = message.from?.username;
    const fromId = message.from?.id;
    if (fromUsername && fromId) {
      prisma.user
        .updateMany({
          where: {
            telegramUsername: fromUsername,
            OR: [{ telegramId: null }, { telegramId: String(fromId) }],
          },
          data: { telegramId: String(fromId) },
        })
        .catch(() => {});
    }

    if (!message.text) {
      return NextResponse.json({ ok: true });
    }

    const text = message.text.trim();

    // /start command
    if (text === "/start" || text.startsWith("/start@")) {
      const welcomeText = [
        `👋 *Welcome to Help & Grow!*`,
        ``,
        `The *AI Native Expert Network*—Singapore & Southeast Asia. Everyone's both expert and learner. What are you looking for?`,
        ``,
        `• _"I need advice on expanding my AI startup in SEA"_`,
        `• _"Looking for an AI expert with localisation experience"_`,
        `• _"Who can help with fundraising in Singapore?"_`,
        ``,
        `Or use these commands:`,
        `/find <your need> — Find the right people`,
        `/help — Show this help message`,
      ].join("\n");

      await sendMessage(botToken, chatId, welcomeText, {
        reply_markup: {
          inline_keyboard: [
            [webAppButton("🚀 Open Help & Grow", "/")],
            [webAppButton("🔍 Discover Community")],
          ],
        },
      });
      return NextResponse.json({ ok: true });
    }

    // /help command
    if (text === "/help" || text.startsWith("/help@")) {
      const helpText = [
        `*Help & Grow Bot*`,
        ``,
        `💬 *Chat with me* — Tell me what you're looking for and I'll recommend the best matches.`,
        ``,
        `*Commands:*`,
        `/find <description> — Find people matching your needs`,
        `/browse — Open chat discovery in the app`,
        `/help — Show this message`,
        ``,
        `You can also type any question naturally!`,
      ].join("\n");

      await sendMessage(botToken, chatId, helpText);
      return NextResponse.json({ ok: true });
    }

    // /browse command — opens web app chat discovery (no directory list)
    if (text === "/browse" || text.startsWith("/browse@")) {
      await sendMessage(
        botToken,
        chatId,
        `Open the app to chat with our AI and get matched to experts:`,
        {
          reply_markup: {
            inline_keyboard: [
              [webAppButton("🔍 Chat to discover")],
            ],
          },
        }
      );
      return NextResponse.json({ ok: true });
    }

    // /find command or regular text → AI expert matching
    let query = text;
    if (text.startsWith("/find")) {
      query = text.replace(/^\/find(@\w+)?\s*/, "").trim();
      if (!query) {
        await sendMessage(
          botToken,
          chatId,
          `Please describe what you're looking for.\nExample: /find marketing expert for SaaS startup`
        );
        return NextResponse.json({ ok: true });
      }
    }

    // Show "typing" indicator
    await sendChatAction(botToken, chatId, "typing");

    const result = await chat(query);

    if (result.experts.length > 0) {
      const lines = result.experts.map(
        (e, i) =>
          `*${i + 1}. ${e.name}*${e.priceLabel ? ` — ${e.priceLabel}` : ""}\n${e.reason}`
      );
      const replyText = `🎯 *Expert Recommendations*\n\n${lines.join("\n\n")}`;

      const buttons = buildExpertButtons(result.experts);
      buttons.push([webAppButton("🔍 Discover More")]);

      await sendMessage(botToken, chatId, replyText, {
        reply_markup: { inline_keyboard: buttons },
      });
    } else {
      await sendMessage(botToken, chatId, result.reply, {
        reply_markup: {
          inline_keyboard: [
            [webAppButton("🔍 Discover More")],
          ],
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[webhooks/telegram]", message, error);
    return NextResponse.json({ ok: true });
  }
}

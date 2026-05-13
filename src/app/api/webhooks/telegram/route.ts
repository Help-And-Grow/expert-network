import { type NextRequest, NextResponse } from "next/server";

import type { SessionType } from "@/generated/prisma/client";
import { findParticipantBookingConflict } from "@/lib/booking-utils";
import { chat } from "@/lib/chat-engine";
import { storeBookingEvent } from "@/lib/integrations/mem9-lifecycle";
import { prisma } from "@/lib/prisma";
import { notifyExpertBooking } from "@/lib/telegram-bot";

const APP_URL =
  process.env.NEXTAUTH_URL || "https://www.help-and-grow.com";

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

async function answerInlineQuery(
  botToken: string,
  inlineQueryId: string,
  results: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {}
) {
  await fetch(`https://api.telegram.org/bot${botToken}/answerInlineQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inline_query_id: inlineQueryId,
      results,
      cache_time: 300,
      is_personal: true,
      ...extra,
    }),
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

// ---------------------------------------------------------------------------
// Group-chat support
// ---------------------------------------------------------------------------
//
// In a Telegram group, the bot only sees messages that command-ping it or
// mention `@<botUsername>` (under default privacy-mode ON — see
// BotFather /setprivacy). We further gate ourselves so bare text in a group
// is ignored unless it mentions us — otherwise the bot would spam the group
// on every non-command message. Commands like `/start@helpAndGrowBot` keep
// working unchanged.
//
// `web_app` inline-keyboard buttons only function in private chats, so for
// group replies we format an inline-Markdown reply (with clickable links)
// instead of the button grid used in DMs.

type TelegramMessage = {
  message_id?: number;
  chat?: { id?: number; type?: string };
  text?: string;
  entities?: Array<{ type?: string; offset?: number; length?: number; user?: { username?: string } }>;
  reply_to_message?: { from?: { username?: string } };
};

let cachedBotUsername: string | null = null;
async function getBotUsername(botToken: string): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  const fromEnv = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (fromEnv) {
    cachedBotUsername = fromEnv;
    return cachedBotUsername;
  }
  // Fallback: ask Telegram. Cached for the lifetime of this serverless
  // instance so we don't pay the round trip on every group message.
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = await res.json();
    if (data?.ok && typeof data.result?.username === "string") {
      cachedBotUsername = data.result.username;
      return cachedBotUsername;
    }
  } catch (err) {
    console.error("[telegram/getMe]", err);
  }
  return null;
}

function isGroupChat(message: TelegramMessage): boolean {
  const t = message.chat?.type;
  return t === "group" || t === "supergroup";
}

/**
 * Has the bot been addressed in this group message? Three cases:
 *   1. `@<botUsername>` literal in the text (entity type "mention").
 *   2. Telegram-native text_mention pointing at our user.
 *   3. A reply to a previous bot message.
 */
function isBotAddressed(message: TelegramMessage, botUsername: string): boolean {
  const target = botUsername.toLowerCase();
  const text = message.text ?? "";
  for (const e of message.entities ?? []) {
    if (e.type === "mention" && typeof e.offset === "number" && typeof e.length === "number") {
      const slice = text.slice(e.offset, e.offset + e.length).toLowerCase();
      if (slice === `@${target}`) return true;
    }
    if (e.type === "text_mention" && e.user?.username?.toLowerCase() === target) {
      return true;
    }
  }
  if (message.reply_to_message?.from?.username?.toLowerCase() === target) {
    return true;
  }
  return false;
}

/** Strip the bot's @-mention(s) and command suffixes, return the residual question. */
function stripBotMention(text: string, botUsername: string): string {
  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`@${escaped}`, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();
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

    // --- Inline Query handling ---
    if (update.inline_query) {
      const qId = update.inline_query.id;
      const fromId = String(update.inline_query.from.id);
      const queryText = update.inline_query.query.trim();
      const queryLower = queryText.toLowerCase();
      const results: Record<string, unknown>[] = [];

      const buildExpertCard = (
        expert: { id: string; bio: string | null; reviewCount: number; avgRating: number },
        user: { name: string | null; nickName: string | null; image: string | null },
        sharerLabel?: string,
      ): Record<string, unknown> => {
        const name = user.nickName || user.name || "Expert";
        const shareUrl = `${APP_URL}/experts/${expert.id}`;
        const bookUrl = `${APP_URL}/experts/${expert.id}/book`;
        const ratingText =
          expert.reviewCount > 0
            ? `⭐ ${expert.avgRating.toFixed(1)} (${expert.reviewCount} reviews)`
            : "New Expert";
        const referrer = sharerLabel ? `\n\n_Shared by ${sharerLabel}_` : "";
        return {
          type: "article",
          id: `expert_${expert.id}`,
          title: name,
          description: `${ratingText}\n${expert.bio?.slice(0, 100) || ""}`,
          thumb_url: user.image || undefined,
          input_message_content: {
            message_text: `*${name} — Expert Profile*\n\n${expert.bio || ""}\n\n${ratingText}${referrer}`,
            parse_mode: "Markdown",
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 View Profile", web_app: { url: shareUrl } }],
              [{ text: "📅 Book Session", web_app: { url: bookUrl } }],
            ],
          },
        };
      };

      // Resolve who is sharing (used for attribution + the "me" shortcut).
      const sharer = await prisma.user.findFirst({
        where: { telegramId: fromId },
        include: { expert: true },
      });
      const sharerLabel = sharer?.nickName || sharer?.name || undefined;

      // Self-share shortcut: "me" or empty query when caller has a published profile.
      if ((queryLower === "me" || queryLower === "") && sharer?.expert?.isPublished) {
        results.push(buildExpertCard(sharer.expert, sharer));
      }

      // Friend-to-friend search: free-text → published experts whose name/bio matches.
      if (queryText.length >= 2 && queryLower !== "me") {
        const matches = await prisma.expert.findMany({
          where: {
            isPublished: true,
            OR: [
              { user: { name: { contains: queryText, mode: "insensitive" } } },
              { user: { nickName: { contains: queryText, mode: "insensitive" } } },
              { bio: { contains: queryText, mode: "insensitive" } },
            ],
          },
          include: { user: true },
          orderBy: [{ avgRating: "desc" }, { reviewCount: "desc" }],
          take: 10,
        });
        for (const expert of matches) {
          results.push(buildExpertCard(expert, expert.user, sharerLabel));
        }
      }

      await answerInlineQuery(botToken, qId, results);
      return NextResponse.json({ ok: true });
    }

    // --- Successful payment ---
    const payment = update.message?.successful_payment;
    if (payment) {
      const payload = JSON.parse(payment.invoice_payload);
      const chatId = update.message.chat.id;
      const totalCents = Number(payload.totalCents ?? 0);
      const paidAmountCents = Number(
        payload.amountCents ?? payload.dueNowCents ?? payload.depositCents ?? totalCents
      );
      const isLegacyDeposit =
        payload.type === "booking_deposit" && paidAmountCents < totalCents;
      const bookingStart = new Date(payload.startTime);
      const bookingEnd = new Date(payload.endTime);

      const conflict = await findParticipantBookingConflict({
        expertId: payload.expertId,
        founderId: payload.founderId,
        startTime: bookingStart,
        endTime: bookingEnd,
      });
      if (conflict) {
        console.error(
          `[webhooks/telegram] Paid checkout conflicts with booking ${conflict.id}; not creating confirmed booking.`,
        );
        await sendMessage(
          botToken,
          chatId,
          "Payment received, but this time slot now conflicts with another meetup. Please contact support so we can resolve it."
        );
        return NextResponse.json({ ok: true });
      }

      const booking = await prisma.booking.create({
        data: {
          expertId: payload.expertId,
          founderId: payload.founderId,
          sessionType: (payload.sessionType || "ONLINE") as SessionType,
          startTime: bookingStart,
          endTime: bookingEnd,
          timezone: payload.timezone || "Asia/Singapore",
          meetingLink: payload.meetingLink || null,
          status: "CONFIRMED",
          totalAmountCents: totalCents,
          depositAmountCents: paidAmountCents,
          currency: payload.currency || "SGD",
          paymentMethod: "telegram_payments",
          paymentStatus: isLegacyDeposit ? "deposit_paid" : "fully_paid",
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
    const inGroup = isGroupChat(message);

    // In groups, only respond when we're explicitly addressed. Commands
    // already self-target via the `/cmd@botname` convention; bare text
    // (the AI-match path) requires an @-mention or a reply-to-bot.
    let groupQuery: string | null = null;
    if (inGroup) {
      const botUsername = await getBotUsername(botToken);
      if (!botUsername) {
        // Can't determine our identity → don't spam the group.
        return NextResponse.json({ ok: true });
      }

      const isCommand = text.startsWith("/");
      const targetsUs = isCommand
        ? text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)
        : isBotAddressed(message, botUsername);

      if (!targetsUs) {
        return NextResponse.json({ ok: true });
      }

      if (!isCommand) {
        groupQuery = stripBotMention(text, botUsername);
        if (!groupQuery) {
          await sendMessage(
            botToken,
            chatId,
            `Hi! Mention me with your question — e.g. \`@${botUsername} fundraising experts in Singapore\``,
            { reply_to_message_id: message.message_id }
          );
          return NextResponse.json({ ok: true });
        }
      }
    }

    // /start command
    if (text === "/start" || text.startsWith("/start@")) {
      const welcomeText = [
        `👋 *Welcome to Help & Grow!*`,
        ``,
        `The expert network for Singapore & Southeast Asia. Everyone's both coach and player — learn by doing, grow by helping. What are you looking for?`,
        ``,
        `• _"I need advice on expanding my startup in SEA"_`,
        `• _"Looking for an expert with localisation experience"_`,
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
        `Open the app to describe what you need and get matched to experts:`,
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
          `Please describe what you're looking for.\nExample: /find marketing expert for SaaS startup`,
          inGroup ? { reply_to_message_id: message.message_id } : {}
        );
        return NextResponse.json({ ok: true });
      }
    } else if (groupQuery) {
      // Bare @-mention in a group — the question is the residue after the mention.
      query = groupQuery;
    }

    // Show "typing" indicator
    await sendChatAction(botToken, chatId, "typing");

    const result = await chat(query, [], "telegram");

    if (inGroup) {
      // Group reply: inline-Markdown with clickable links (web_app buttons
      // don't work in groups). Thread under the original question.
      const replyExtra = { reply_to_message_id: message.message_id };

      if (result.experts.length > 0) {
        const lines = result.experts.slice(0, 5).map((e, i) => {
          const price = e.priceLabel ? ` — ${e.priceLabel}` : "";
          return [
            `*${i + 1}. [${e.name}](${e.profileUrl})*${price}`,
            e.reason,
            `[Book →](${e.bookUrl})`,
          ].join("\n");
        });
        const header = `🎯 *Expert recommendations*`;
        const footer = `\n[Discover more](${APP_URL}/discover)`;
        let replyText = `${header}\n\n${lines.join("\n\n")}${footer}`;
        // Telegram caps a single message at 4096 chars.
        if (replyText.length > 4000) {
          replyText = replyText.slice(0, 3990) + "…";
        }
        await sendMessage(botToken, chatId, replyText, {
          ...replyExtra,
          disable_web_page_preview: true,
        });
      } else {
        const replyText = `${result.reply}\n\n[Discover more](${APP_URL}/discover)`;
        await sendMessage(botToken, chatId, replyText, {
          ...replyExtra,
          disable_web_page_preview: true,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // Private chat reply: keep the existing web_app button UX.
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

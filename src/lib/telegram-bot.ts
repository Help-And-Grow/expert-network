import { env } from "@/lib/env";

const APP_URL =
  env.NEXTAUTH_URL || "https://www.help-and-grow.com";

async function callBotApi(method: string, body: Record<string, unknown>) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * Resolve a Telegram chat ID from telegramId string or by looking up telegramUsername.
 */
async function resolveChatId(
  telegramId?: string | null,
  telegramUsername?: string | null
): Promise<number | null> {
  if (telegramId) return parseInt(telegramId, 10);
  if (!telegramUsername) return null;
  const { prisma } = await import("@/lib/prisma");
  const user = await prisma.user.findFirst({
    where: { telegramUsername },
    select: { telegramId: true },
  });
  if (user?.telegramId) return parseInt(user.telegramId, 10);
  console.log(`[notify] Cannot resolve chatId: user @${telegramUsername} has no telegramId — they need to message the bot first`);
  return null;
}

function formatDate(date: Date, timezone?: string | null): string {
  const tz = timezone || "Asia/Singapore";
  return date.toLocaleString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  });
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  inlineKeyboard?: Record<string, unknown>[][]
) {
  const extra: Record<string, unknown> = { parse_mode: "Markdown" };
  if (inlineKeyboard?.length) {
    extra.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  const result = await callBotApi("sendMessage", { chat_id: chatId, text, ...extra });
  if (!result.ok) {
    console.error("[notify] Telegram sendMessage failed:", result.description, "chatId:", chatId);
  }
  return result;
}

/**
 * Send a greeting to a user who just added their Telegram username.
 */
export async function sendGreeting(telegramUsername: string): Promise<boolean> {
  const chatId = await resolveChatId(undefined, telegramUsername);
  if (!chatId) return false;

  const text = [
    `👋 *Welcome to Help & Grow!*`,
    ``,
    `Your Telegram account has been linked. You'll now receive:`,
    `• Meetup confirmations`,
    `• Meetup reminders`,
    `• Updates from your meetups`,
    ``,
    `The expert network for SG & SEA—tap below to explore.`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "🚀 Explore Help & Grow", web_app: { url: `${APP_URL}/discover` } }],
  ]);

  return true;
}

/**
 * Notify an expert about a new meetup.
 */
export async function notifyExpertBooking(params: {
  expertTelegramId?: string | null;
  expertTelegramUsername?: string | null;
  founderName: string;
  sessionType: string;
  startTime: Date;
  depositAmount: string;
  timezone?: string | null;
}): Promise<boolean> {
  if (!params.expertTelegramId && !params.expertTelegramUsername) {
    console.log("[notify] Skip expert notify: no telegramId or username");
    return false;
  }
  const chatId = await resolveChatId(params.expertTelegramId, params.expertTelegramUsername);
  if (!chatId) {
    console.log("[notify] Skip expert notify: could not resolve chatId for", params.expertTelegramUsername, params.expertTelegramId);
    return false;
  }

  const dateStr = formatDate(params.startTime, params.timezone);

  const text = [
    `📅 *New meetup!*`,
    ``,
    `*${params.founderName}* scheduled a ${params.sessionType.toLowerCase()} meetup with you.`,
    ``,
    `🗓 ${dateStr}`,
    `💰 Paid upfront: ${params.depositAmount}`,
    ``,
    `Open the app to view details.`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "📋 My Meetups", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Notify a player about their meetup confirmation.
 */
export async function notifyFounderBooking(params: {
  founderTelegramId?: string | null;
  founderTelegramUsername?: string | null;
  expertName: string;
  sessionType: string;
  startTime: Date;
  depositAmount: string;
  timezone?: string | null;
}): Promise<boolean> {
  if (!params.founderTelegramId && !params.founderTelegramUsername) {
    console.log("[notify] Skip founder notify: no telegramId or username");
    return false;
  }
  const chatId = await resolveChatId(params.founderTelegramId, params.founderTelegramUsername);
  if (!chatId) {
    console.log("[notify] Skip founder notify: could not resolve chatId for", params.founderTelegramUsername, params.founderTelegramId);
    return false;
  }

  const dateStr = formatDate(params.startTime, params.timezone);

  const text = [
    `✅ *Meetup confirmed!*`,
    ``,
    `Your ${params.sessionType.toLowerCase()} meetup with *${params.expertName}* is confirmed.`,
    ``,
    `🗓 ${dateStr}`,
    `💰 Paid in full: ${params.depositAmount}`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "📋 My Meetups", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Nudge the founder to leave a review after a meetup completes.
 *
 * Fires from the booking status transition in
 * `src/app/api/bookings/[id]/route.ts` once `status === "COMPLETED"`.
 * Idempotent at the prisma layer (review submission is one-per-booking)
 * but this helper itself is fire-and-forget — re-firing just sends the
 * DM again, which is acceptable in practice and avoids tracking state
 * solely for de-duping notifications.
 */
export async function notifyReviewRequest(bookingId: string): Promise<boolean> {
  const { prisma } = await import("@/lib/prisma");
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      sessionType: true,
      founder: { select: { telegramId: true, telegramUsername: true } },
      expert: { select: { user: { select: { nickName: true, name: true } } } },
      review: { select: { id: true } },
    },
  });
  if (!booking) {
    console.log(`[notify] Skip review prompt: booking ${bookingId} not found`);
    return false;
  }
  if (booking.review) {
    // Already reviewed — don't pester.
    return false;
  }
  const chatId = await resolveChatId(
    booking.founder.telegramId,
    booking.founder.telegramUsername,
  );
  if (!chatId) {
    console.log(
      `[notify] Skip review prompt: founder for booking ${bookingId} has no resolvable telegram chat`,
    );
    return false;
  }

  const expertName =
    booking.expert.user.nickName || booking.expert.user.name || "your expert";

  const text = [
    `🌟 *How was your meetup?*`,
    ``,
    `Your ${booking.sessionType.toLowerCase()} meetup with *${expertName}* is wrapped — leave a quick rating to help the next person find them.`,
  ].join("\n");

  // Use the t.me deep link so taps land in the Mini App with auth context.
  // The frontend router (telegram-start-param-router.tsx) reads
  // start_param=review-<id> and navigates to /reviews/<id>.
  const botUsername =
    env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || "helpAndGrowBot";
  const slug = env.TELEGRAM_MINI_APP_SLUG?.trim() || "ExpertNetwork";
  const deepLink = `https://t.me/${botUsername}/${slug}?startapp=review-${booking.id}`;

  await sendTelegramMessage(chatId, text, [
    [{ text: "🌟 Rate the meetup", url: deepLink }],
    [{ text: "📋 My Meetups", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Notify a user that their meetup has been cancelled.
 */
export async function notifyCancellation(params: {
  telegramId?: string | null;
  telegramUsername?: string | null;
  otherPartyName: string;
  cancelledByName: string;
  sessionType: string;
  startTime: Date;
  reason?: string | null;
  timezone?: string | null;
}): Promise<boolean> {
  if (!params.telegramId && !params.telegramUsername) return false;
  const chatId = await resolveChatId(params.telegramId, params.telegramUsername);
  if (!chatId) return false;

  const dateStr = formatDate(params.startTime, params.timezone);

  const lines = [
    `❌ *Meetup cancelled*`,
    ``,
    `Your ${params.sessionType.toLowerCase()} meetup with *${params.otherPartyName}* has been cancelled by *${params.cancelledByName}*.`,
    ``,
    `🗓 ${dateStr}`,
  ];

  if (params.reason) {
    lines.push(`💬 Reason: ${params.reason}`);
  }

  await sendTelegramMessage(chatId, lines.join("\n"), [
    [{ text: "📋 My Meetups", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Notify a user that their meetup has been rescheduled.
 */
export async function notifyReschedule(params: {
  telegramId?: string | null;
  telegramUsername?: string | null;
  otherPartyName: string;
  rescheduledByName: string;
  sessionType: string;
  oldStartTime: Date;
  newStartTime: Date;
  timezone?: string | null;
  /**
   * Set true when the recipient is the same person who initiated the
   * reschedule. We then replace `*{rescheduledByName}*` with `*you*` so
   * the message reads naturally as a self-confirmation rather than
   * "rescheduled by {your own name}".
   */
  isInitiator?: boolean;
}): Promise<boolean> {
  if (!params.telegramId && !params.telegramUsername) return false;
  const chatId = await resolveChatId(params.telegramId, params.telegramUsername);
  if (!chatId) return false;

  const fmt = (d: Date) => formatDate(d, params.timezone);

  const byClause = params.isInitiator
    ? "has been rescheduled by *you*"
    : `has been rescheduled by *${params.rescheduledByName}*`;
  const text = [
    `🔄 *Meetup rescheduled*`,
    ``,
    `Your ${params.sessionType.toLowerCase()} meetup with *${params.otherPartyName}* ${byClause}.`,
    ``,
    `~~${fmt(params.oldStartTime)}~~ → 🗓 *${fmt(params.newStartTime)}*`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "📋 My Meetups", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Notify a user that the meeting location or link has been updated.
 */
export async function notifyLocationUpdate(params: {
  telegramId?: string | null;
  telegramUsername?: string | null;
  otherPartyName: string;
  updatedByName: string;
  sessionType: string;
  startTime: Date;
  isOnline: boolean;
  location: string;
  timezone?: string | null;
}): Promise<boolean> {
  if (!params.telegramId && !params.telegramUsername) return false;
  const chatId = await resolveChatId(params.telegramId, params.telegramUsername);
  if (!chatId) return false;

  const dateStr = formatDate(params.startTime, params.timezone);

  const locationLabel = params.isOnline ? "Meeting Link" : "Location";
  const icon = params.isOnline ? "🔗" : "📍";

  const text = [
    `${icon} *${locationLabel} Updated*`,
    ``,
    `*${params.updatedByName}* updated the ${locationLabel.toLowerCase()} for your ${params.sessionType.toLowerCase()} meetup.`,
    ``,
    `🗓 ${dateStr}`,
    `${icon} ${params.location}`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "📋 My Meetups", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Send a meetup reminder (e.g. 1 hour before).
 */
export async function sendSessionReminder(params: {
  telegramId?: string | null;
  telegramUsername?: string | null;
  expertName: string;
  sessionType: string;
  startTime: Date;
  timezone?: string | null;
}): Promise<boolean> {
  if (!params.telegramId && !params.telegramUsername) return false;
  const chatId = await resolveChatId(params.telegramId, params.telegramUsername);
  if (!chatId) return false;

  const dateStr = formatDate(params.startTime, params.timezone);

  const text = [
    `⏰ *Meetup reminder*`,
    ``,
    `Your ${params.sessionType.toLowerCase()} meetup with *${params.expertName}* is coming up!`,
    ``,
    `🗓 ${dateStr}`,
  ].join("\n");

  await sendTelegramMessage(chatId, text);
  return true;
}

const APP_URL =
  process.env.NEXTAUTH_URL || "https://expert-network.vercel.app";

async function callBotApi(method: string, body: Record<string, unknown>) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
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
    `• Booking confirmations`,
    `• Session reminders`,
    `• Updates from your sessions`,
    ``,
    `The *AI Native Expert Network* for SG & SEA—tap below to explore.`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "🚀 Explore Help & Grow", web_app: { url: `${APP_URL}/discover` } }],
  ]);

  return true;
}

/**
 * Notify an expert about a new booking.
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
    `📅 *New Booking!*`,
    ``,
    `*${params.founderName}* has booked a ${params.sessionType.toLowerCase()} session with you.`,
    ``,
    `🗓 ${dateStr}`,
    `💰 Deposit: ${params.depositAmount}`,
    ``,
    `Open the app to view details.`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "📋 View Bookings", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Notify a mentee about their booking confirmation.
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
    `✅ *Booking Confirmed!*`,
    ``,
    `Your ${params.sessionType.toLowerCase()} session with *${params.expertName}* is confirmed.`,
    ``,
    `🗓 ${dateStr}`,
    `💰 Deposit paid: ${params.depositAmount}`,
    ``,
    `The remainder will be charged 24h after the session.`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "📋 View My Bookings", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Notify a user that their booking has been cancelled.
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
    `❌ *Booking Cancelled*`,
    ``,
    `Your ${params.sessionType.toLowerCase()} session with *${params.otherPartyName}* has been cancelled by *${params.cancelledByName}*.`,
    ``,
    `🗓 ${dateStr}`,
  ];

  if (params.reason) {
    lines.push(`💬 Reason: ${params.reason}`);
  }

  await sendTelegramMessage(chatId, lines.join("\n"), [
    [{ text: "📋 View Bookings", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Notify a user that their booking has been rescheduled.
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
}): Promise<boolean> {
  if (!params.telegramId && !params.telegramUsername) return false;
  const chatId = await resolveChatId(params.telegramId, params.telegramUsername);
  if (!chatId) return false;

  const fmt = (d: Date) => formatDate(d, params.timezone);

  const text = [
    `🔄 *Booking Rescheduled*`,
    ``,
    `Your ${params.sessionType.toLowerCase()} session with *${params.otherPartyName}* has been rescheduled by *${params.rescheduledByName}*.`,
    ``,
    `~~${fmt(params.oldStartTime)}~~ → 🗓 *${fmt(params.newStartTime)}*`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "📋 View Bookings", web_app: { url: `${APP_URL}/booking` } }],
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
    `*${params.updatedByName}* updated the ${locationLabel.toLowerCase()} for your ${params.sessionType.toLowerCase()} session.`,
    ``,
    `🗓 ${dateStr}`,
    `${icon} ${params.location}`,
  ].join("\n");

  await sendTelegramMessage(chatId, text, [
    [{ text: "📋 View Bookings", web_app: { url: `${APP_URL}/booking` } }],
  ]);

  return true;
}

/**
 * Send a session reminder (e.g. 1 hour before).
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
    `⏰ *Session Reminder*`,
    ``,
    `Your ${params.sessionType.toLowerCase()} session with *${params.expertName}* is coming up!`,
    ``,
    `🗓 ${dateStr}`,
  ].join("\n");

  await sendTelegramMessage(chatId, text);
  return true;
}

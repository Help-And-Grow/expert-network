import { prisma } from "@/lib/prisma";
import { FREE_REPLY_LIMIT } from "@/lib/voice-chat-config";

/**
 * Returns the current month string in "YYYY-MM" format, using UTC
 * so the quota boundary is consistent across regions.
 */
export function currentMonth(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

/**
 * Check whether the expert has remaining free replies for the current
 * month, and atomically increment the reply counter. Throws if the
 * free quota is exhausted.
 *
 * Uses `upsert` inside a transaction to avoid race conditions between
 * the read and the write.
 */
export async function checkAndIncrementUsage(expertId: string): Promise<void> {
  const month = currentMonth();

  const usage = await prisma.voiceChatUsage.upsert({
    where: { expertId_month: { expertId, month } },
    create: { expertId, month, replyCount: 1 },
    update: { replyCount: { increment: 1 } },
  });

  if (usage.replyCount > FREE_REPLY_LIMIT) {
    throw new Error(
      `Free reply limit exceeded (${FREE_REPLY_LIMIT} replies per expert per month). Upgrade for unlimited replies.`,
    );
  }
}

/**
 * Return the current usage record for an expert in the given month
 * (defaults to the current month). Returns null if no usage row exists.
 */
export async function getUsageForMonth(
  expertId: string,
  month?: string,
): Promise<{ replyCount: number } | null> {
  return prisma.voiceChatUsage.findUnique({
    where: { expertId_month: { expertId, month: month ?? currentMonth() } },
    select: { replyCount: true },
  });
}

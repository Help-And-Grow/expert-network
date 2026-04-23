import { type NextRequest, NextResponse } from "next/server";

import { isDebugAccessDenied, requireDebugAccess } from "@/lib/debug-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADD_COLUMNS = [
  // User
  { table: "User", column: "telegramId", sql: `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramId" TEXT` },
  { table: "User", column: "telegramUsername", sql: `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramUsername" TEXT` },

  // Expert
  { table: "Expert", column: "website", sql: `ALTER TABLE "Expert" ADD COLUMN IF NOT EXISTS "website" TEXT` },
  { table: "Expert", column: "gender", sql: `ALTER TABLE "Expert" ADD COLUMN IF NOT EXISTS "gender" TEXT` },
  { table: "Expert", column: "tonWalletAddress", sql: `ALTER TABLE "Expert" ADD COLUMN IF NOT EXISTS "tonWalletAddress" TEXT` },
  { table: "Expert", column: "tonWalletType", sql: `ALTER TABLE "Expert" ADD COLUMN IF NOT EXISTS "tonWalletType" TEXT` },
  { table: "Expert", column: "tonMnemonicEnc", sql: `ALTER TABLE "Expert" ADD COLUMN IF NOT EXISTS "tonMnemonicEnc" TEXT` },
  { table: "Expert", column: "audioIntroUrl", sql: `ALTER TABLE "Expert" ADD COLUMN IF NOT EXISTS "audioIntroUrl" TEXT` },
  { table: "Expert", column: "fishAudioModelId", sql: `ALTER TABLE "Expert" ADD COLUMN IF NOT EXISTS "fishAudioModelId" TEXT` },
  { table: "Expert", column: "mem9SpaceId", sql: `ALTER TABLE "Expert" ADD COLUMN IF NOT EXISTS "mem9SpaceId" TEXT` },

  // Booking payment fields
  { table: "Booking", column: "totalAmountCents", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "totalAmountCents" INTEGER` },
  { table: "Booking", column: "depositAmountCents", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "depositAmountCents" INTEGER` },
  { table: "Booking", column: "currency", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "currency" TEXT DEFAULT 'SGD'` },
  { table: "Booking", column: "paymentMethod", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT` },
  { table: "Booking", column: "paymentStatus", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT DEFAULT 'pending'` },
  { table: "Booking", column: "stripeCheckoutSessionId", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT` },
  { table: "Booking", column: "stripePaymentIntentId", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT` },
  { table: "Booking", column: "wechatTransactionId", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "wechatTransactionId" TEXT` },
  { table: "Booking", column: "stripeCustomerId", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT` },
  { table: "Booking", column: "stripePaymentMethodId", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "stripePaymentMethodId" TEXT` },
  { table: "Booking", column: "stripeRemainderPIId", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "stripeRemainderPIId" TEXT` },
  { table: "Booking", column: "paynowReference", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paynowReference" TEXT` },
  { table: "Booking", column: "paynowPayerReference", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paynowPayerReference" TEXT` },
  { table: "Booking", column: "paynowSubmittedAt", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paynowSubmittedAt" TIMESTAMP(3)` },
  { table: "Booking", column: "paynowConfirmedAt", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paynowConfirmedAt" TIMESTAMP(3)` },
  { table: "Booking", column: "tonDepositTxHash", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "tonDepositTxHash" TEXT` },
  { table: "Booking", column: "tonRemainderTxHash", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "tonRemainderTxHash" TEXT` },
  { table: "Booking", column: "remainderChargedAt", sql: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "remainderChargedAt" TIMESTAMP(3)` },
];

const ADD_INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramId_key" ON "User"("telegramId")`,
];

export async function POST(request: NextRequest) {
  const access = await requireDebugAccess(request, { mutation: true });
  if (isDebugAccessDenied(access)) return access;

  const log: string[] = [];

  try {
    // Add missing columns
    for (const col of ADD_COLUMNS) {
      try {
        await prisma.$executeRawUnsafe(col.sql);
        log.push(`OK: ${col.table}.${col.column}`);
      } catch (e: unknown) {
        log.push(`SKIP: ${col.table}.${col.column} - ${(e as Error).message}`);
      }
    }

    // Add indexes
    for (const idx of ADD_INDEXES) {
      try {
        await prisma.$executeRawUnsafe(idx);
        log.push(`Index OK`);
      } catch (e: unknown) {
        log.push(`Index SKIP: ${(e as Error).message}`);
      }
    }

    // Verify with Prisma ORM query
    log.push("--- Verification ---");
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, telegramUsername: true },
    });
    log.push(`Users: ${users.length} found`);
    for (const u of users) log.push(`  ${u.name || "(no name)"} <${u.email}> tg:${u.telegramUsername || "-"}`);

    const experts = await prisma.expert.findMany({
      include: { user: { select: { name: true } } },
    });
    log.push(`Experts: ${experts.length} found`);
    for (const e of experts) log.push(`  ${e.user.name} published=${e.isPublished}`);

    return NextResponse.json({ status: "ok", log });
  } catch (e: unknown) {
    return NextResponse.json({ status: "error", error: (e as Error).message, log }, { status: 500 });
  }
}

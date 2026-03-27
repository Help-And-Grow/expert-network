import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveUserId } from "@/lib/request-auth";

const MIGRATIONS = [
  `ALTER TABLE "Expert" ADD COLUMN IF NOT EXISTS "stripeAccountStatus" TEXT DEFAULT 'none'`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "wechatOpenId" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "wechatUnionId" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_wechatOpenId_key" ON "User"("wechatOpenId")`,
  // Reset test-mode Stripe Connected Accounts so experts re-KYC in live mode
  `UPDATE "Expert" SET "stripeAccountId" = NULL, "stripeAccountStatus" = 'none' WHERE "stripeAccountId" IS NOT NULL`,
  `ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "expertSuggestion" TEXT`,
  `ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "suggestionAt" TIMESTAMP`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inviteCode" TEXT`,
  `CREATE TABLE IF NOT EXISTS "InvitationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 10,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "note" TEXT,
    "expiresAt" TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvitationCode_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "InvitationCode_code_key" ON "InvitationCode"("code")`,
  // POMP (Proof of Meet Protocol) migrations
  `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "tokenDiscount" INTEGER DEFAULT 0`,
  `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "tokensRedeemed" INTEGER DEFAULT 0`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenBalance" INTEGER DEFAULT 0`,
  `DROP TABLE IF EXISTS "POVPCredential"`,
  `CREATE TABLE IF NOT EXISTS "POMPCredential" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "attestationUID" TEXT NOT NULL,
    "recipient" TEXT,
    "hours" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "POMPCredential_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "POMPCredential_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE,
    CONSTRAINT "POMPCredential_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "POMPCredential_attestationUID_key" ON "POMPCredential"("attestationUID")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "POMPCredential_bookingId_recipientRole_key" ON "POMPCredential"("bookingId", "recipientRole")`,
  `CREATE INDEX IF NOT EXISTS "POMPCredential_expertId_idx" ON "POMPCredential"("expertId")`,
  `CREATE TABLE IF NOT EXISTS "TokenLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenLedger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TokenLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "TokenLedger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "TokenLedger_userId_idx" ON "TokenLedger"("userId")`,
  `CREATE INDEX IF NOT EXISTS "TokenLedger_bookingId_idx" ON "TokenLedger"("bookingId")`,
  // Postgres / Supabase only (TiDB will ERR — safe to ignore in migrate output)
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS expert_memory_embeddings (
    id TEXT NOT NULL PRIMARY KEY,
    expert_id TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT,
    source TEXT,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_expert_memory_expert ON expert_memory_embeddings (expert_id)`,
];

/**
 * POST /api/admin/migrate
 * Runs pending schema migrations. Protected — only admin users can call this.
 * Remove this endpoint after all migrations are applied.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const results: string[] = [];

    for (const sql of MIGRATIONS) {
      try {
        await prisma.$executeRawUnsafe(sql);
        results.push(`OK: ${sql.slice(0, 80)}...`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push(`ERR: ${sql.slice(0, 60)}... → ${msg}`);
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[admin/migrate]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

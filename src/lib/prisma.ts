import { Prisma, PrismaClient } from "@/generated/prisma/client";

import { assertProductionEnv } from "@/lib/env";

assertProductionEnv();

const BOOKING_SCHEMA_COMPAT_OMIT = {
  booking: {
    isPremiumLive: true,
    liveRoomId: true,
    liveDurationMinutes: true,
    liveAccessChargedAt: true,
  },
} as const satisfies Prisma.PrismaClientOptions["omit"];

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createCompatPrismaClient> | undefined;
  prismaFull: PrismaClient | undefined;
};

function createPrismaAdapter() {
  const url = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

  if (url.startsWith("mysql://")) {
    throw new Error(
      "[prisma] DATABASE_URL is MySQL — no longer supported. Use PostgreSQL (Supabase recommended). See docs/exec-plans/active/postgres-cutover-runbook.md",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");
  
  const pool = new Pool({ connectionString: url });
  return new PrismaPg(pool);
}

function createCompatPrismaClient() {
  // Keep the main app working while TRTC schema fields are ahead of the current database.
  const adapter = createPrismaAdapter();
  return new PrismaClient({ adapter, omit: BOOKING_SCHEMA_COMPAT_OMIT });
}

function createFullPrismaClient() {
  const adapter = createPrismaAdapter();
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createCompatPrismaClient();
export const prismaFull = globalForPrisma.prismaFull ?? createFullPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaFull = prismaFull;
}

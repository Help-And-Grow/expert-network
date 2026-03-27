import { PrismaClient } from "@/generated/prisma/client";

import { assertProductionEnv } from "@/lib/env";

assertProductionEnv();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const url = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

  if (url.startsWith("mysql://")) {
    throw new Error(
      "[prisma] DATABASE_URL is MySQL — no longer supported. Use PostgreSQL (Supabase/TiDB Serverless Postgres if available) and DB_PROVIDER=supabase. See docs/exec-plans/active/postgres-cutover-runbook.md",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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
  const { Pool } = require("pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");
  
  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

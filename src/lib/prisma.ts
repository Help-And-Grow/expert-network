import { PrismaClient } from "@/generated/prisma/client";

import { assertProductionEnv, resolvePrimaryDatabaseUrl } from "@/lib/env";
import { createPostgresPool } from "@/lib/postgres-pool";

assertProductionEnv();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaAdapter() {
  const url = resolvePrimaryDatabaseUrl() || "postgresql://mock:mock@localhost:5432/mock";

  if (url.startsWith("mysql://")) {
    throw new Error(
      "[prisma] DATABASE_URL is MySQL — no longer supported. Use PostgreSQL (Supabase recommended). See docs/exec-plans/active/postgres-cutover-runbook.md",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");

  const pool = createPostgresPool(url);
  return new PrismaPg(pool);
}

function createPrismaClient() {
  const adapter = createPrismaAdapter();
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
export const prismaFull = prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

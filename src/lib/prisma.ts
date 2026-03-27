import { PrismaClient } from "@/generated/prisma/client";

import { assertProductionEnv } from "@/lib/env";

assertProductionEnv();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const url = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

  if (url.startsWith("mysql://")) {
    // TiDB / MySQL path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
    const parsed = new URL(url);
    const adapter = new PrismaMariaDb({
      host: parsed.hostname,
      port: parseInt(parsed.port || "3306"),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, "") || undefined,
      ssl: parsed.searchParams.get("sslaccept") === "strict"
        ? { rejectUnauthorized: true }
        : parsed.hostname.includes("tidbcloud.com")
          ? { rejectUnauthorized: false }
          : undefined,
      connectTimeout: 10000,
    });
    return new PrismaClient({ adapter });
  }

  // Supabase / PostgreSQL path
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

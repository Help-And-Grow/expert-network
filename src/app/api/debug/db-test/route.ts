import { type NextRequest, NextResponse } from "next/server";

import { isDebugAccessDenied, requireDebugAccess } from "@/lib/debug-api";
import { resolvePrimaryDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireDebugAccess(request);
  if (isDebugAccessDenied(access)) return access;

  const resolvedDb = resolvePrimaryDatabaseUrl();
  const info: Record<string, unknown> = {
    dbUrl: resolvedDb
      ? resolvedDb.replace(/:[^@]+@/, ":***@").substring(0, 80)
      : undefined,
    directUrl: process.env.DIRECT_URL?.replace(/:[^@]+@/, ":***@").substring(0, 80),
    dbProvider: process.env.DB_PROVIDER || "(not set)",
    timestamp: new Date().toISOString(),
  };

  try {
    const result = await prisma.$queryRawUnsafe("SELECT 1 as ok");
    info.connection = "OK";
    info.queryResult = result;

    const userCount = await prisma.user.count();
    info.userCount = userCount;

    const expertCount = await prisma.expert.count();
    info.expertCount = expertCount;
  } catch (e: unknown) {
    const err = e as Error;
    info.connection = "FAILED";
    info.error = err.message;
    info.errorName = err.name;
    if ("code" in err) info.errorCode = (err as { code: string }).code;
  }

  return NextResponse.json(info);
}

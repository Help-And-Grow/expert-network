import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const info: Record<string, unknown> = {
    dbUrl: process.env.DATABASE_URL?.replace(/:[^@]+@/, ":***@").substring(0, 80),
    directUrl: process.env.DIRECT_URL?.replace(/:[^@]+@/, ":***@").substring(0, 80),
    hiClawDbUrl:
      process.env.HICLAW_POSTGRES_URL?.replace(/:[^@]+@/, ":***@").substring(0, 80) ??
      "(falls back to DATABASE_URL)",
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

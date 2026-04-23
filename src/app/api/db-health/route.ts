import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Prisma connectivity check (SELECT 1). Lives at `/api/db-health` because `/api/health`
 * is already a leaf route and cannot have a `/db` child in the App Router.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1 as ok`;
    return NextResponse.json({ ok: true, db: "up" });
  } catch (error) {
    console.error("[db-health]", error);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}

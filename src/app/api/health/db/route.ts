import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Optional DB connectivity check (does not validate full schema). Use after deploy / env changes.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1 as ok`;
    return NextResponse.json({ ok: true, db: "up" });
  } catch (error) {
    console.error("[health/db]", error);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}

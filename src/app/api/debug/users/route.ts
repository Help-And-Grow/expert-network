import { type NextRequest, NextResponse } from "next/server";

import { isDebugAccessDenied, requireDebugAccess } from "@/lib/debug-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireDebugAccess(request);
  if (isDebugAccessDenied(access)) return access;

  const results: Record<string, unknown> = {};

  try {
    // Check actual columns in key tables
    for (const table of ["User", "Expert", "Booking", "AvailableSlot"]) {
      const cols = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`
      );
      results[table] = cols.map((c) => `${c.column_name} (${c.data_type})`);
    }

    // Try a simple raw query on users
    const users = await prisma.$queryRawUnsafe(
      `SELECT id, name, email, role FROM "User" LIMIT 5`
    );
    results.sampleUsers = users;

  } catch (e: unknown) {
    results.error = (e as Error).message;
  }

  return NextResponse.json(results);
}

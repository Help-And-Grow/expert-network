import { type NextRequest, NextResponse } from "next/server";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/admin/providers/drift?environment=production&resolved=false
 *
 * Lists drift rows surfaced by the /api/cron/provider-drift job.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const sp = request.nextUrl.searchParams;
  const environment = sp.get("environment") ?? undefined;
  const resolvedParam = sp.get("resolved");
  const resolved =
    resolvedParam === "true"
      ? true
      : resolvedParam === "false"
        ? false
        : undefined;

  const rows = await prisma.providerConfigDrift.findMany({
    where: {
      ...(environment ? { environment } : {}),
      ...(resolved !== undefined ? { resolved } : {}),
    },
    orderBy: { detectedAt: "desc" },
    take: 200,
  });

  const unresolvedCount = await prisma.providerConfigDrift.count({
    where: { resolved: false, ...(environment ? { environment } : {}) },
  });

  return NextResponse.json({ rows, unresolvedCount });
}

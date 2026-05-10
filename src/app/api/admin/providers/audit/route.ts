import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/admin/providers/audit
 *
 * Paginated tail of `ProviderConfigChange`. Filters: category, environment,
 * configKey (exact), actorEmail (exact), date range.
 */
const querySchema = z.object({
  category: z.string().min(1).optional(),
  environment: z
    .enum(["production", "preview", "development"])
    .optional(),
  configKey: z.string().min(1).optional(),
  actorEmail: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    category: sp.get("category") ?? undefined,
    environment: sp.get("environment") ?? undefined,
    configKey: sp.get("configKey") ?? undefined,
    actorEmail: sp.get("actorEmail") ?? undefined,
    since: sp.get("since") ?? undefined,
    until: sp.get("until") ?? undefined,
    limit: sp.get("limit") ?? undefined,
    cursor: sp.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.format() },
      { status: 400 },
    );
  }

  const limit = parsed.data.limit ?? 25;
  const where: Record<string, unknown> = {};
  if (parsed.data.category) where.category = parsed.data.category;
  if (parsed.data.environment) where.environment = parsed.data.environment;
  if (parsed.data.configKey) where.configKey = parsed.data.configKey;
  if (parsed.data.actorEmail) where.actorEmail = parsed.data.actorEmail;
  if (parsed.data.since || parsed.data.until) {
    where.changedAt = {
      ...(parsed.data.since ? { gte: new Date(parsed.data.since) } : {}),
      ...(parsed.data.until ? { lte: new Date(parsed.data.until) } : {}),
    };
  }

  const rows = await prisma.providerConfigChange.findMany({
    where,
    orderBy: { changedAt: "desc" },
    take: limit + 1,
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id ?? null : null;

  return NextResponse.json({
    rows: sliced.map((r) => ({
      id: r.id,
      changedAt: r.changedAt.toISOString(),
      actorEmail: r.actorEmail,
      actorRole: r.actorRole,
      category: r.category,
      configKey: r.configKey,
      environment: r.environment,
      before: r.before,
      after: r.after,
      reason: r.reason,
    })),
    nextCursor,
    hasMore,
  });
}

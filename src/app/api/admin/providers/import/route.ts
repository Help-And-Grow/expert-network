import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveEnvironment } from "@/lib/system-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/providers/import
 *
 * Imports a provider-config snapshot produced by `/api/admin/providers/export`.
 *
 *   { mode: 'merge'|'replace', dryRun?: boolean, environment?, payload }
 *
 *   merge   → upsert each row, leave non-mentioned rows alone
 *   replace → delete every system-config / scope / override row in the
 *             target env, then insert fresh; registry rows are upserted
 *             (registry is global, never deleted by import)
 *   dryRun  → return the diff summary without applying
 *
 * Always audited with a single `category=import` row capturing counts.
 * Refuses to import any system-config row whose value === "***REDACTED***"
 * (silent no-op for that row, surfaced in the response).
 */

const registryRowSchema = z.object({
  category: z.string(),
  key: z.string(),
  displayName: z.string(),
  enabled: z.boolean().optional(),
  envKeys: z.unknown(),
  models: z.unknown(),
  metadata: z.unknown().optional(),
  sortOrder: z.number().int().optional(),
});

const systemConfigRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  environment: z.string().optional(),
});

const routingScopeRowSchema = z.object({
  scopeKey: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  category: z.string(),
  chain: z.unknown(),
  enabled: z.boolean().optional(),
  matchRules: z.unknown(),
  priority: z.number().int().optional(),
  environment: z.string().optional(),
});

const routeOverrideRowSchema = z.object({
  routePattern: z.string(),
  category: z.string(),
  chainOverride: z.unknown(),
  enabled: z.boolean().optional(),
  reason: z.string().nullable().optional(),
  environment: z.string().optional(),
});

const bodySchema = z.object({
  mode: z.enum(["merge", "replace"]),
  dryRun: z.boolean().optional(),
  environment: z.enum(["production", "preview", "development"]).optional(),
  reason: z.string().max(500).optional(),
  payload: z.object({
    registry: z.array(registryRowSchema).optional(),
    systemConfig: z.array(systemConfigRowSchema).optional(),
    routingScopes: z.array(routingScopeRowSchema).optional(),
    routeOverrides: z.array(routeOverrideRowSchema).optional(),
  }),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.format() },
      { status: 400 },
    );
  }

  const { mode, dryRun = false, payload, reason } = parsed.data;
  const environment = resolveEnvironment(parsed.data.environment);

  // Refuse rows with a redacted value — they would otherwise overwrite
  // legit secrets with the literal string "***REDACTED***".
  const skippedRedacted: string[] = [];
  const safeSystemConfig = (payload.systemConfig ?? []).filter((r) => {
    if (r.value === "***REDACTED***") {
      skippedRedacted.push(r.key);
      return false;
    }
    return true;
  });

  const summary = {
    mode,
    environment,
    counts: {
      registry: payload.registry?.length ?? 0,
      systemConfig: safeSystemConfig.length,
      routingScopes: payload.routingScopes?.length ?? 0,
      routeOverrides: payload.routeOverrides?.length ?? 0,
    },
    skippedRedactedKeys: skippedRedacted,
  };

  if (dryRun) {
    // Compute the keys that would be deleted on `replace`.
    const wouldDelete = mode === "replace"
      ? {
          systemConfig: (
            await prisma.systemConfig.findMany({
              where: { environment },
              select: { key: true },
            })
          ).map((r) => r.key),
          routingScopes: (
            await prisma.providerRoutingScope.findMany({
              where: { environment },
              select: { scopeKey: true, category: true },
            })
          ).map((r) => `${r.category}:${r.scopeKey}`),
          routeOverrides: (
            await prisma.providerRouteOverride.findMany({
              where: { environment },
              select: { routePattern: true, category: true },
            })
          ).map((r) => `${r.category}:${r.routePattern}`),
        }
      : null;

    return NextResponse.json({
      dryRun: true,
      summary,
      wouldDelete,
    });
  }

  const actor = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { email: true },
  });
  const actorEmail = actor?.email ?? null;

  const before = {
    registry: await prisma.providerRegistry.count(),
    systemConfig: await prisma.systemConfig.count({ where: { environment } }),
    routingScopes: await prisma.providerRoutingScope.count({
      where: { environment },
    }),
    routeOverrides: await prisma.providerRouteOverride.count({
      where: { environment },
    }),
  };

  await prisma.$transaction(async (tx) => {
    if (mode === "replace") {
      await tx.systemConfig.deleteMany({ where: { environment } });
      await tx.providerRoutingScope.deleteMany({ where: { environment } });
      await tx.providerRouteOverride.deleteMany({ where: { environment } });
    }

    // Registry: always upsert (registry is global, never deleted by import).
    for (const r of payload.registry ?? []) {
      await tx.providerRegistry.upsert({
        where: { category_key: { category: r.category, key: r.key } },
        create: {
          category: r.category,
          key: r.key,
          displayName: r.displayName,
          enabled: r.enabled ?? true,
          envKeys: (r.envKeys ?? {}) as Prisma.InputJsonValue,
          models: (r.models ?? {}) as Prisma.InputJsonValue,
          metadata:
            r.metadata == null
              ? Prisma.JsonNull
              : (r.metadata as Prisma.InputJsonValue),
          sortOrder: r.sortOrder ?? 0,
        },
        update: {
          displayName: r.displayName,
          enabled: r.enabled ?? true,
          envKeys: (r.envKeys ?? {}) as Prisma.InputJsonValue,
          models: (r.models ?? {}) as Prisma.InputJsonValue,
          metadata:
            r.metadata == null
              ? Prisma.JsonNull
              : (r.metadata as Prisma.InputJsonValue),
          sortOrder: r.sortOrder ?? 0,
        },
      });
    }

    for (const r of safeSystemConfig) {
      await tx.systemConfig.upsert({
        where: {
          key_environment: { key: r.key, environment },
        },
        create: { key: r.key, value: r.value, environment },
        update: { value: r.value },
      });
    }

    for (const s of payload.routingScopes ?? []) {
      await tx.providerRoutingScope.upsert({
        where: {
          scopeKey_category_environment: {
            scopeKey: s.scopeKey,
            category: s.category,
            environment,
          },
        },
        create: {
          scopeKey: s.scopeKey,
          displayName: s.displayName,
          description: s.description ?? null,
          category: s.category,
          chain: (s.chain ?? []) as Prisma.InputJsonValue,
          enabled: s.enabled ?? true,
          matchRules: (s.matchRules ?? {}) as Prisma.InputJsonValue,
          priority: s.priority ?? 100,
          environment,
        },
        update: {
          displayName: s.displayName,
          description: s.description ?? null,
          chain: (s.chain ?? []) as Prisma.InputJsonValue,
          enabled: s.enabled ?? true,
          matchRules: (s.matchRules ?? {}) as Prisma.InputJsonValue,
          priority: s.priority ?? 100,
        },
      });
    }

    for (const o of payload.routeOverrides ?? []) {
      await tx.providerRouteOverride.upsert({
        where: {
          routePattern_category_environment: {
            routePattern: o.routePattern,
            category: o.category,
            environment,
          },
        },
        create: {
          routePattern: o.routePattern,
          category: o.category,
          chainOverride: (o.chainOverride ?? []) as Prisma.InputJsonValue,
          enabled: o.enabled ?? true,
          reason: o.reason ?? null,
          environment,
        },
        update: {
          chainOverride: (o.chainOverride ?? []) as Prisma.InputJsonValue,
          enabled: o.enabled ?? true,
          reason: o.reason ?? null,
        },
      });
    }

    const after = {
      registry: await tx.providerRegistry.count(),
      systemConfig: await tx.systemConfig.count({ where: { environment } }),
      routingScopes: await tx.providerRoutingScope.count({
        where: { environment },
      }),
      routeOverrides: await tx.providerRouteOverride.count({
        where: { environment },
      }),
    };

    await tx.providerConfigChange.create({
      data: {
        actorEmail,
        actorRole: "ADMIN",
        category: "import",
        configKey: "snapshot",
        environment,
        before: before as Prisma.InputJsonValue,
        after: { ...after, mode, skippedRedactedKeys: skippedRedacted } as Prisma.InputJsonValue,
        reason: reason ?? `Import (${mode})`,
      },
    });
  });

  return NextResponse.json({ ok: true, summary });
}

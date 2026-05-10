import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveEnvironment } from "@/lib/system-config";

/**
 * Phase 3 routing resolver.
 *
 * Replaces the hard-coded WeChat-vs-Web split in `provider-catalog.ts` with
 * a DB-backed `ProviderRoutingScope` table. Each scope binds a request shape
 * (matchRules) to an ordered chain. Per-route overrides
 * (`ProviderRouteOverride`) take precedence over scope chains.
 *
 * Precedence (highest → lowest):
 *   1. ProviderRouteOverride (matched by `routePattern` + category + env).
 *   2. ProviderRoutingScope (lowest `priority` whose `matchRules` matches).
 *   3. Hard-coded fallback (legacy env-driven path) — caller-supplied via
 *      the `fallback` argument so we don't pull catalog deps in here.
 *
 * Cached for 60s in-process to keep request-path latency flat.
 */

const CACHE_TTL = 60 * 1000;

export type RoutingCategory = "llm" | "image" | "voice" | "storage";

export type RoutingOrigin = {
  isWeChat: boolean;
  region?: "intl" | "cn" | null;
  routePath?: string | null;
  userAgent?: string | null;
  /** Arbitrary headers an admin can match against, e.g. `x-tenant`. */
  headers?: Record<string, string | undefined>;
};

export type RoutingScopeRow = {
  id: string;
  scopeKey: string;
  displayName: string;
  description: string | null;
  category: string;
  chain: string[];
  enabled: boolean;
  matchRules: RoutingMatchRules;
  priority: number;
  environment: string;
  createdAt: Date;
  updatedAt: Date;
};

export type RoutingMatchRules = {
  isWeChat?: boolean;
  region?: "intl" | "cn";
  userAgent?: string;
  header?: Record<string, string>;
};

export type RouteOverrideRow = {
  id: string;
  routePattern: string;
  category: string;
  chainOverride: string[];
  enabled: boolean;
  reason: string | null;
  environment: string;
  createdAt: Date;
  updatedAt: Date;
};

type ScopeCacheEntry = { rows: RoutingScopeRow[]; expires: number };
type OverrideCacheEntry = { rows: RouteOverrideRow[]; expires: number };

const scopeCache: Record<string, ScopeCacheEntry> = {};
const overrideCache: Record<string, OverrideCacheEntry> = {};

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
}

function coerceMatchRules(value: unknown): RoutingMatchRules {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const rules: RoutingMatchRules = {};
  if (typeof v.isWeChat === "boolean") rules.isWeChat = v.isWeChat;
  if (v.region === "intl" || v.region === "cn") rules.region = v.region;
  if (typeof v.userAgent === "string" && v.userAgent.trim().length > 0) {
    rules.userAgent = v.userAgent;
  }
  if (v.header && typeof v.header === "object") {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.header as Record<string, unknown>)) {
      if (typeof val === "string") out[k.toLowerCase()] = val;
    }
    if (Object.keys(out).length > 0) rules.header = out;
  }
  return rules;
}

export async function listRoutingScopes(
  category: RoutingCategory,
  environment: string,
  opts: { enabledOnly?: boolean; force?: boolean } = {},
): Promise<RoutingScopeRow[]> {
  const cacheKey = `${category}:${environment}:${opts.enabledOnly ? "e" : "a"}`;
  const now = Date.now();
  if (!opts.force) {
    const cached = scopeCache[cacheKey];
    if (cached && cached.expires > now) return cached.rows;
  }
  try {
    const rows = await prisma.providerRoutingScope.findMany({
      where: {
        category,
        environment,
        ...(opts.enabledOnly ? { enabled: true } : {}),
      },
      orderBy: [{ priority: "asc" }, { scopeKey: "asc" }],
    });
    const mapped: RoutingScopeRow[] = rows.map((r) => ({
      id: r.id,
      scopeKey: r.scopeKey,
      displayName: r.displayName,
      description: r.description,
      category: r.category,
      chain: coerceStringArray(r.chain),
      enabled: r.enabled,
      matchRules: coerceMatchRules(r.matchRules),
      priority: r.priority,
      environment: r.environment,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    scopeCache[cacheKey] = { rows: mapped, expires: now + CACHE_TTL };
    return mapped;
  } catch (err) {
    console.warn(
      `[routing] listRoutingScopes(${category},${environment}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function listRouteOverrides(
  category: RoutingCategory,
  environment: string,
  opts: { enabledOnly?: boolean; force?: boolean } = {},
): Promise<RouteOverrideRow[]> {
  const cacheKey = `${category}:${environment}:${opts.enabledOnly ? "e" : "a"}`;
  const now = Date.now();
  if (!opts.force) {
    const cached = overrideCache[cacheKey];
    if (cached && cached.expires > now) return cached.rows;
  }
  try {
    const rows = await prisma.providerRouteOverride.findMany({
      where: {
        category,
        environment,
        ...(opts.enabledOnly ? { enabled: true } : {}),
      },
      orderBy: [{ routePattern: "asc" }],
    });
    const mapped: RouteOverrideRow[] = rows.map((r) => ({
      id: r.id,
      routePattern: r.routePattern,
      category: r.category,
      chainOverride: coerceStringArray(r.chainOverride),
      enabled: r.enabled,
      reason: r.reason,
      environment: r.environment,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    overrideCache[cacheKey] = { rows: mapped, expires: now + CACHE_TTL };
    return mapped;
  } catch (err) {
    console.warn(
      `[routing] listRouteOverrides(${category},${environment}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * `routePattern` matching: simple `startsWith` semantics. A trailing `*`
 * means "anything starts with this prefix". No regex by design — easier
 * to reason about for operators editing rules in the admin UI.
 */
export function matchesRoutePattern(routePath: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return routePath.startsWith(prefix);
  }
  return routePath === pattern;
}

export function getRouteOverrideChain(
  routePath: string,
  overrides: RouteOverrideRow[],
): string[] | null {
  for (const o of overrides) {
    if (!o.enabled) continue;
    if (matchesRoutePattern(routePath, o.routePattern)) {
      if (o.chainOverride.length > 0) return o.chainOverride;
    }
  }
  return null;
}

/**
 * Returns true if the scope's match rules apply to this origin. Empty
 * rules object = catch-all. Each non-null rule field must equal the
 * corresponding value on the origin.
 */
export function matchesScope(
  rules: RoutingMatchRules,
  origin: RoutingOrigin,
): boolean {
  if (rules.isWeChat !== undefined && rules.isWeChat !== origin.isWeChat) {
    return false;
  }
  if (rules.region !== undefined) {
    if (!origin.region) return false;
    if (rules.region !== origin.region) return false;
  }
  if (rules.userAgent !== undefined) {
    const ua = origin.userAgent ?? "";
    if (!ua.toLowerCase().includes(rules.userAgent.toLowerCase())) return false;
  }
  if (rules.header) {
    for (const [name, expected] of Object.entries(rules.header)) {
      const actual = origin.headers?.[name.toLowerCase()];
      if (actual !== expected) return false;
    }
  }
  return true;
}

export type ResolveOptions = {
  /**
   * Last-resort fallback chain when (a) the DB read fails, or (b) no scope
   * matches the origin. Caller provides this from the legacy env path so
   * `routing.ts` doesn't import the catalog (would be a circular dep).
   */
  fallback: () => Promise<string[]> | string[];
};

/**
 * Per-category provider chain resolver. See module-level doc for precedence.
 * Always returns at least one provider key (or an empty array if the caller
 * fallback also returned nothing — defensive).
 */
export async function resolveChainForRequest(
  category: RoutingCategory,
  origin: RoutingOrigin,
  environment: string | null | undefined,
  options: ResolveOptions,
): Promise<string[]> {
  const env = resolveEnvironment(environment);

  // 1. Route override has the highest precedence.
  if (origin.routePath) {
    const overrides = await listRouteOverrides(category, env, {
      enabledOnly: true,
    });
    const overrideChain = getRouteOverrideChain(origin.routePath, overrides);
    if (overrideChain && overrideChain.length > 0) return overrideChain;
  }

  // 2. Routing scopes (priority ASC; first match wins).
  const scopes = await listRoutingScopes(category, env, { enabledOnly: true });
  for (const scope of scopes) {
    if (matchesScope(scope.matchRules, origin) && scope.chain.length > 0) {
      return scope.chain;
    }
  }

  // 3. Caller-supplied legacy fallback.
  const fallback = await options.fallback();
  return fallback;
}

export function invalidateRoutingCache(): void {
  for (const k of Object.keys(scopeCache)) delete scopeCache[k];
  for (const k of Object.keys(overrideCache)) delete overrideCache[k];
}

// ---------------------------------------------------------------------------
// Upsert helpers (used by /api/admin/providers POST). Each upsert audits.
// ---------------------------------------------------------------------------

export type UpsertScopeInput = {
  scopeKey: string;
  displayName: string;
  description?: string | null;
  category: RoutingCategory;
  chain: string[];
  enabled?: boolean;
  matchRules: RoutingMatchRules;
  priority?: number;
  environment?: string;
};

export type UpsertOverrideInput = {
  routePattern: string;
  category: RoutingCategory;
  chainOverride: string[];
  enabled?: boolean;
  reason?: string | null;
  environment?: string;
};

export type RoutingAuditOptions = {
  actorEmail?: string | null;
  actorRole?: "ADMIN" | "SYSTEM" | (string & {}) | null;
  reason?: string | null;
  tx?: Prisma.TransactionClient;
};

export async function upsertRoutingScope(
  input: UpsertScopeInput,
  audit?: RoutingAuditOptions,
): Promise<RoutingScopeRow> {
  const env = resolveEnvironment(input.environment ?? "production");
  const db = audit?.tx ?? prisma;

  const existing = await db.providerRoutingScope.findUnique({
    where: {
      scopeKey_category_environment: {
        scopeKey: input.scopeKey,
        category: input.category,
        environment: env,
      },
    },
  });
  const before = existing
    ? {
        scopeKey: existing.scopeKey,
        displayName: existing.displayName,
        description: existing.description,
        category: existing.category,
        chain: coerceStringArray(existing.chain),
        enabled: existing.enabled,
        matchRules: coerceMatchRules(existing.matchRules),
        priority: existing.priority,
      }
    : null;

  const chainJson = input.chain as unknown as Prisma.InputJsonValue;
  const matchRulesJson = input.matchRules as unknown as Prisma.InputJsonValue;

  const row = await db.providerRoutingScope.upsert({
    where: {
      scopeKey_category_environment: {
        scopeKey: input.scopeKey,
        category: input.category,
        environment: env,
      },
    },
    create: {
      scopeKey: input.scopeKey,
      displayName: input.displayName,
      description: input.description ?? null,
      category: input.category,
      chain: chainJson,
      enabled: input.enabled ?? true,
      matchRules: matchRulesJson,
      priority: input.priority ?? 100,
      environment: env,
    },
    update: {
      displayName: input.displayName,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      chain: chainJson,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      matchRules: matchRulesJson,
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    },
  });
  const after = {
    scopeKey: row.scopeKey,
    displayName: row.displayName,
    description: row.description,
    category: row.category,
    chain: coerceStringArray(row.chain),
    enabled: row.enabled,
    matchRules: coerceMatchRules(row.matchRules),
    priority: row.priority,
  };

  const changed = !before || JSON.stringify(before) !== JSON.stringify(after);
  if (changed) {
    await db.providerConfigChange.create({
      data: {
        actorEmail: audit?.actorEmail ?? null,
        actorRole: audit?.actorRole ?? "ADMIN",
        category: "routing-scope",
        configKey: `routing-scope:${input.category}:${input.scopeKey}`,
        environment: env,
        before:
          before === null
            ? Prisma.JsonNull
            : (before as unknown as Prisma.InputJsonValue),
        after: after as unknown as Prisma.InputJsonValue,
        reason: audit?.reason ?? null,
      },
    });
  }

  invalidateRoutingCache();
  return {
    id: row.id,
    scopeKey: row.scopeKey,
    displayName: row.displayName,
    description: row.description,
    category: row.category,
    chain: coerceStringArray(row.chain),
    enabled: row.enabled,
    matchRules: coerceMatchRules(row.matchRules),
    priority: row.priority,
    environment: row.environment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function upsertRouteOverride(
  input: UpsertOverrideInput,
  audit?: RoutingAuditOptions,
): Promise<RouteOverrideRow> {
  const env = resolveEnvironment(input.environment ?? "production");
  const db = audit?.tx ?? prisma;

  const existing = await db.providerRouteOverride.findUnique({
    where: {
      routePattern_category_environment: {
        routePattern: input.routePattern,
        category: input.category,
        environment: env,
      },
    },
  });
  const before = existing
    ? {
        routePattern: existing.routePattern,
        category: existing.category,
        chainOverride: coerceStringArray(existing.chainOverride),
        enabled: existing.enabled,
        reason: existing.reason,
      }
    : null;

  const chainJson = input.chainOverride as unknown as Prisma.InputJsonValue;

  const row = await db.providerRouteOverride.upsert({
    where: {
      routePattern_category_environment: {
        routePattern: input.routePattern,
        category: input.category,
        environment: env,
      },
    },
    create: {
      routePattern: input.routePattern,
      category: input.category,
      chainOverride: chainJson,
      enabled: input.enabled ?? true,
      reason: input.reason ?? null,
      environment: env,
    },
    update: {
      chainOverride: chainJson,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    },
  });
  const after = {
    routePattern: row.routePattern,
    category: row.category,
    chainOverride: coerceStringArray(row.chainOverride),
    enabled: row.enabled,
    reason: row.reason,
  };

  const changed = !before || JSON.stringify(before) !== JSON.stringify(after);
  if (changed) {
    await db.providerConfigChange.create({
      data: {
        actorEmail: audit?.actorEmail ?? null,
        actorRole: audit?.actorRole ?? "ADMIN",
        category: "route-override",
        configKey: `route-override:${input.category}:${input.routePattern}`,
        environment: env,
        before:
          before === null
            ? Prisma.JsonNull
            : (before as unknown as Prisma.InputJsonValue),
        after: after as unknown as Prisma.InputJsonValue,
        reason: audit?.reason ?? null,
      },
    });
  }

  invalidateRoutingCache();
  return {
    id: row.id,
    routePattern: row.routePattern,
    category: row.category,
    chainOverride: coerceStringArray(row.chainOverride),
    enabled: row.enabled,
    reason: row.reason,
    environment: row.environment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function deleteRouteOverride(
  routePattern: string,
  category: RoutingCategory,
  environment: string,
  audit?: RoutingAuditOptions,
): Promise<void> {
  const env = resolveEnvironment(environment);
  const db = audit?.tx ?? prisma;
  const existing = await db.providerRouteOverride.findUnique({
    where: {
      routePattern_category_environment: {
        routePattern,
        category,
        environment: env,
      },
    },
  });
  if (!existing) return;
  await db.providerRouteOverride.delete({
    where: {
      routePattern_category_environment: {
        routePattern,
        category,
        environment: env,
      },
    },
  });
  await db.providerConfigChange.create({
    data: {
      actorEmail: audit?.actorEmail ?? null,
      actorRole: audit?.actorRole ?? "ADMIN",
      category: "route-override",
      configKey: `route-override:${category}:${routePattern}`,
      environment: env,
      before: {
        routePattern: existing.routePattern,
        category: existing.category,
        chainOverride: coerceStringArray(existing.chainOverride),
        enabled: existing.enabled,
        reason: existing.reason,
      } as unknown as Prisma.InputJsonValue,
      after: Prisma.JsonNull,
      reason: audit?.reason ?? "deleted",
    },
  });
  invalidateRoutingCache();
}

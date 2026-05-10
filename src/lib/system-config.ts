import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Per-environment-scoped SystemConfig helpers.
 *
 * Phase 2 of the admin-page revamp added an `environment` column to
 * `SystemConfig` (production / preview / development) so admin operators
 * can rotate providers in preview without touching production traffic.
 *
 * Defaults: every helper resolves the environment to `process.env.VERCEL_ENV`
 * if unset, falling back to "production" outside Vercel. This keeps every
 * existing call site (`setSystemConfig(key, value)`) working unchanged
 * while also writing a row to `ProviderConfigChange` for audit.
 */

const CACHE_TTL = 60 * 1000; // 1 minute
const cache: Record<string, { value: string | null; expires: number }> = {};

export type Environment = "production" | "preview" | "development";

export type SetSystemConfigOptions = {
  /** Optional admin-supplied note recorded in the audit log. */
  reason?: string | null;
  /** Email of the human triggering the write. null/undefined = system. */
  actorEmail?: string | null;
  /** "ADMIN" for human writes, "SYSTEM" for cron/automation. Default ADMIN. */
  actorRole?: "ADMIN" | "SYSTEM" | (string & {}) | null;
  /** Category recorded in the audit row. Default "system-config". */
  category?: string;
};

export function resolveEnvironment(env?: string | null): Environment {
  if (env === "production" || env === "preview" || env === "development") {
    return env;
  }
  const fromVercel = process.env.VERCEL_ENV;
  if (
    fromVercel === "production" ||
    fromVercel === "preview" ||
    fromVercel === "development"
  ) {
    return fromVercel;
  }
  return "production";
}

function cacheKey(env: Environment, key: string): string {
  return `${env}:${key}`;
}

/**
 * Fetches a system configuration value scoped to an environment, with
 * 60s in-process caching keyed by `${env}:${key}`. Defaults to the current
 * Vercel deployment's environment (or "production" outside Vercel).
 */
export async function getSystemConfig(
  key: string,
  environment?: string | null,
): Promise<string | null> {
  const env = resolveEnvironment(environment);
  const ck = cacheKey(env, key);
  const now = Date.now();
  if (cache[ck] && cache[ck].expires > now) {
    return cache[ck].value;
  }

  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key_environment: { key, environment: env } },
    });
    const value = config?.value ?? null;
    cache[ck] = { value, expires: now + CACHE_TTL };
    return value;
  } catch (e) {
    // Silently fall back to null if DB is not ready or table missing
    console.warn(
      `[SystemConfig] Failed to fetch key "${key}" (env=${env}):`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Upserts a SystemConfig value for the given environment and writes an
 * audit row. Backwards-compatible: `setSystemConfig(key, value)` still
 * works and writes to the current environment with `actorRole='ADMIN'`.
 *
 * Pass a Prisma transaction client via `options.tx` (internal) to coalesce
 * the upsert + audit row into the same transaction.
 */
export async function setSystemConfig(
  key: string,
  value: string,
  environment?: string | null,
  options?: SetSystemConfigOptions & { tx?: Prisma.TransactionClient },
): Promise<{ before: string | null; after: string }> {
  const env = resolveEnvironment(environment);
  const db = options?.tx ?? prisma;

  const existing = await db.systemConfig.findUnique({
    where: { key_environment: { key, environment: env } },
  });
  const before = existing?.value ?? null;

  await db.systemConfig.upsert({
    where: { key_environment: { key, environment: env } },
    update: { value },
    create: { key, value, environment: env },
  });

  // Skip the audit row when the value didn't actually change — keeps the
  // audit table tidy when the admin clicks Apply twice with no edits.
  if (before !== value) {
    await db.providerConfigChange.create({
      data: {
        actorEmail: options?.actorEmail ?? null,
        actorRole: options?.actorRole ?? "ADMIN",
        category: options?.category ?? "system-config",
        configKey: key,
        environment: env,
        before: before === null ? Prisma.JsonNull : (before as Prisma.InputJsonValue),
        after: value as Prisma.InputJsonValue,
        reason: options?.reason ?? null,
      },
    });
  }

  // Invalidate cache for this env+key. Other envs are unaffected.
  delete cache[cacheKey(env, key)];

  return { before, after: value };
}

/** List every SystemConfig row for one environment (admin UI). */
export async function listSystemConfigByEnvironment(
  environment?: string | null,
): Promise<Array<{ key: string; value: string; environment: string; updatedAt: Date }>> {
  const env = resolveEnvironment(environment);
  const rows = await prisma.systemConfig.findMany({
    where: { environment: env },
    orderBy: { key: "asc" },
    select: { key: true, value: true, environment: true, updatedAt: true },
  });
  return rows;
}

/**
 * Convenience helper to get the active AI provider (production scope).
 * Other call sites should pass an explicit environment when they need to
 * read a non-production value.
 */
export async function getActiveAIProviderNameFromDB(): Promise<string | null> {
  return getSystemConfig("AI_PROVIDER");
}

/** Test-only: clear the in-process cache (used by unit tests). */
export function __clearSystemConfigCache(): void {
  for (const k of Object.keys(cache)) delete cache[k];
}

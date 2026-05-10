import { type NextRequest, NextResponse } from "next/server";

import { DRIFT_MANAGED_KEYS } from "@/lib/admin/cloud-regions";
import { prisma } from "@/lib/prisma";
import { resolveEnvironment } from "@/lib/system-config";
import {
  getManagedVercelProjectConfig,
  listManagedProjectEnvs,
  type ManagedEnvVar,
} from "@/lib/vercel-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron job: provider-config drift detector.
 *
 * For each managed SystemConfig key, compare the DB value against the
 * Vercel project env value (production target). When they differ, write
 * an unresolved `ProviderConfigDrift` row so the admin UI can surface it.
 *
 * Drift rows for the same (configKey, environment) are upserted so
 * repeated runs don't fan out. Once an admin resolves the drift the row
 * is marked `resolved = true` and remains as an audit trail.
 *
 * Secured by the CRON_SECRET header (same convention as
 * /api/cron/charge-remainder).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = getManagedVercelProjectConfig();
  if (!cfg) {
    return NextResponse.json({
      skipped: true,
      reason:
        "No managed Vercel project configured (VERCEL_MANAGEMENT_TOKEN missing). Drift detection requires Vercel API access.",
    });
  }

  const environment = resolveEnvironment(null);

  // Fetch the Vercel-side env vars and pull plaintext values. Vercel only
  // returns redacted/encrypted values on the list endpoint; the v1 GET
  // endpoint returns plaintext for the calling token. We fetch one by one
  // for the keys we care about (small list).
  let vercelEnvs: ManagedEnvVar[];
  try {
    vercelEnvs = await listManagedProjectEnvs(cfg);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to list Vercel envs",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const productionEnvs = vercelEnvs.filter((e) =>
    e.target?.includes("production"),
  );

  // Resolve plaintext for the keys we want — single Vercel API call per key.
  const plaintextById: Record<string, string | null> = {};
  for (const e of productionEnvs) {
    if (!DRIFT_MANAGED_KEYS.includes(e.key)) continue;
    try {
      const val = await fetchVercelEnvDecrypted(cfg, e.id);
      plaintextById[e.id] = val;
    } catch {
      plaintextById[e.id] = null;
    }
  }

  // Now compare with DB.
  const dbRows = await prisma.systemConfig.findMany({
    where: { environment, key: { in: [...DRIFT_MANAGED_KEYS] } },
    select: { key: true, value: true },
  });
  const dbByKey: Record<string, string> = {};
  for (const r of dbRows) dbByKey[r.key] = r.value;

  const driftRows: Array<{
    configKey: string;
    dbValue: string | null;
    vercelValue: string | null;
  }> = [];
  for (const key of DRIFT_MANAGED_KEYS) {
    const dbValue = dbByKey[key] ?? null;
    const vercelEnv = productionEnvs.find((e) => e.key === key);
    const vercelValue = vercelEnv ? plaintextById[vercelEnv.id] ?? null : null;
    // No drift if both unset, or both equal.
    if ((dbValue ?? "") === (vercelValue ?? "")) continue;
    driftRows.push({ configKey: key, dbValue, vercelValue });
  }

  // Upsert drift rows. Strategy: for each (key, env), if there is an open
  // (unresolved) drift row already, update its values; else create a new one.
  let inserted = 0;
  let updated = 0;
  for (const d of driftRows) {
    const existing = await prisma.providerConfigDrift.findFirst({
      where: {
        configKey: d.configKey,
        environment,
        resolved: false,
      },
      orderBy: { detectedAt: "desc" },
    });
    if (existing) {
      await prisma.providerConfigDrift.update({
        where: { id: existing.id },
        data: {
          dbValue: d.dbValue,
          vercelValue: d.vercelValue,
          detectedAt: new Date(),
        },
      });
      updated += 1;
    } else {
      await prisma.providerConfigDrift.create({
        data: {
          configKey: d.configKey,
          environment,
          dbValue: d.dbValue,
          vercelValue: d.vercelValue,
        },
      });
      inserted += 1;
    }
  }

  // Auto-resolve any open drift rows whose underlying drift no longer exists
  // (e.g. an admin pushed/pulled outside this job).
  const driftKeys = new Set(driftRows.map((d) => d.configKey));
  const stillOpen = await prisma.providerConfigDrift.findMany({
    where: { environment, resolved: false },
    select: { id: true, configKey: true },
  });
  let autoResolved = 0;
  for (const row of stillOpen) {
    if (driftKeys.has(row.configKey)) continue;
    await prisma.providerConfigDrift.update({
      where: { id: row.id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: "cron:provider-drift",
        resolvedNote: "Auto-resolved: values match at scan time.",
      },
    });
    autoResolved += 1;
  }

  return NextResponse.json({
    ok: true,
    environment,
    scanned: DRIFT_MANAGED_KEYS.length,
    drift: driftRows.length,
    inserted,
    updated,
    autoResolved,
  });
}

type VercelEnvDetailResponse = {
  value?: string | null;
};

async function fetchVercelEnvDecrypted(
  cfg: { token: string; teamId: string; project: string },
  envId: string,
): Promise<string | null> {
  const url = new URL(
    `https://api.vercel.com/v1/projects/${encodeURIComponent(cfg.project)}/env/${encodeURIComponent(envId)}`,
  );
  url.searchParams.set("teamId", cfg.teamId);
  url.searchParams.set("decrypt", "true");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as VercelEnvDetailResponse;
  return body.value ?? null;
}

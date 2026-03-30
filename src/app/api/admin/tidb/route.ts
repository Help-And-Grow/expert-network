import { type NextRequest, NextResponse } from "next/server";

import { Pool } from "pg";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { HICLAW_PG_SCHEMA_STATEMENTS } from "@/lib/hiclaw-pg-schema-statements";
import {
  type HiClawDbCandidate,
  type HiClawDbEnvKey,
  type HiClawDbResolution,
  resolveHiClawDatabaseUrl,
} from "@/lib/hiclaw-db-env";
import {
  buildHiClawConnectionProbe,
  runHiClawConnectionExperiments,
} from "@/lib/hiclaw-pg-connection-probe";
import { hiClawPgConnectionErrorHint } from "@/lib/hiclaw-pg-error-hint";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type HiClawDbFailure = Extract<HiClawDbResolution, { ok: false }>;

function getPool():
  | {
      pool: Pool;
      source: HiClawDbEnvKey;
      candidates: HiClawDbCandidate[];
      rawPostgresUrl: string;
      normalizedUrl: string;
    }
  | { error: string; diagnosis: HiClawDbFailure } {
  const r = resolveHiClawDatabaseUrl();
  if (!r.ok) {
    return { error: r.error, diagnosis: r };
  }
  return {
    pool: new Pool({
      connectionString: r.url,
      max: 2,
      connectionTimeoutMillis: 10_000,
    }),
    source: r.source,
    candidates: r.candidates,
    rawPostgresUrl: r.rawPostgresUrl,
    normalizedUrl: r.url,
  };
}

/**
 * GET /api/admin/tidb — ping HiClaw Postgres and list core tables (admin only).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const cfg = getPool();
  if ("error" in cfg) {
    return NextResponse.json(
      {
        ok: false,
        error: cfg.error,
        hint: cfg.diagnosis.hint,
        diagnosis: {
          winningSource: cfg.diagnosis.source,
          candidates: cfg.diagnosis.candidates,
        },
      },
      { status: 503 },
    );
  }

  try {
    await cfg.pool.query("SELECT 1 AS ok");

    const { rows } = await cfg.pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
       AND tablename = ANY($1::text[])
       ORDER BY tablename`,
      [["expert_status", "sessions", "waiting_room", "evaluator_critiques"]],
    );

    const tables = rows.map((r) => r.tablename);

    const connectionProbe = buildHiClawConnectionProbe(
      cfg.source,
      cfg.rawPostgresUrl,
      cfg.normalizedUrl,
    );

    return NextResponse.json({
      ok: true,
      message: "HiClaw PostgreSQL connection OK",
      hiclawTablesFound: tables,
      expectedTables: ["expert_status", "sessions", "waiting_room", "evaluator_critiques"],
      diagnosis: {
        resolvedSource: cfg.source,
        candidates: cfg.candidates,
      },
      connectionProbe,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/tidb GET]", msg);
    const hint = hiClawPgConnectionErrorHint(msg);
    const connectionProbe = buildHiClawConnectionProbe(
      cfg.source,
      cfg.rawPostgresUrl,
      cfg.normalizedUrl,
    );
    const connectionExperiments = await runHiClawConnectionExperiments(
      cfg.normalizedUrl,
      cfg.rawPostgresUrl,
    );
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        hint,
        diagnosis: { resolvedSource: cfg.source, candidates: cfg.candidates },
        connectionProbe,
        connectionExperiments,
      },
      { status: 502 },
    );
  } finally {
    await cfg.pool.end().catch(() => {});
  }
}

/**
 * POST /api/admin/tidb — apply HiClaw Postgres schema (idempotent).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  if (body.action !== "apply_hiclaw_schema") {
    return NextResponse.json(
      { error: 'Body must be JSON: { "action": "apply_hiclaw_schema" }' },
      { status: 400 },
    );
  }

  const cfg = getPool();
  if ("error" in cfg) {
    return NextResponse.json(
      {
        ok: false,
        error: cfg.error,
        hint: cfg.diagnosis.hint,
        diagnosis: {
          winningSource: cfg.diagnosis.source,
          candidates: cfg.diagnosis.candidates,
        },
      },
      { status: 503 },
    );
  }

  const results: string[] = [];

  try {
    for (const sql of HICLAW_PG_SCHEMA_STATEMENTS) {
      try {
        await cfg.pool.query(sql);
        results.push(`OK: ${sql.slice(0, 60).replace(/\s+/g, " ")}...`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`ERR: ${sql.slice(0, 40)}... → ${msg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      results,
      diagnosis: { resolvedSource: cfg.source, candidates: cfg.candidates },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/tidb POST]", msg);
    const hint = hiClawPgConnectionErrorHint(msg);
    return NextResponse.json({ ok: false, error: msg, hint, results }, { status: 502 });
  } finally {
    await cfg.pool.end().catch(() => {});
  }
}

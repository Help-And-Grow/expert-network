import { type NextRequest, NextResponse } from "next/server";

import { Pool } from "pg";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { HICLAW_PG_SCHEMA_STATEMENTS } from "@/lib/hiclaw-pg-schema-statements";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getPool(): { pool: Pool } | { error: string } {
  const raw =
    process.env.HICLAW_POSTGRES_URL ||
    process.env.DB9_DATABASE_URL ||
    process.env.TIDB_DATABASE_URL;
  if (!raw?.trim()) {
    return { error: "Set HICLAW_POSTGRES_URL or DB9_DATABASE_URL (PostgreSQL)" };
  }
  const url = raw.trim();
  if (url.startsWith("mysql://")) {
    return { error: "MySQL URLs are no longer supported — use PostgreSQL for HiClaw." };
  }
  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    return { error: "HiClaw database URL must be PostgreSQL." };
  }
  return {
    pool: new Pool({
      connectionString: url,
      max: 2,
      connectionTimeoutMillis: 10_000,
    }),
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
    return NextResponse.json({ ok: false, error: cfg.error }, { status: 503 });
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

    return NextResponse.json({
      ok: true,
      message: "HiClaw PostgreSQL connection OK",
      hiclawTablesFound: tables,
      expectedTables: ["expert_status", "sessions", "waiting_room", "evaluator_critiques"],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/tidb GET]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
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
    return NextResponse.json({ ok: false, error: cfg.error }, { status: 503 });
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

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/tidb POST]", msg);
    return NextResponse.json({ ok: false, error: msg, results }, { status: 502 });
  } finally {
    await cfg.pool.end().catch(() => {});
  }
}

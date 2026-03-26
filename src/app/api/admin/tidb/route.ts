import { type NextRequest, NextResponse } from "next/server";

import mysql from "mysql2/promise";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { HICLAW_TIDB_STATEMENTS } from "@/lib/tidb-hiclaw-schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getConnectionConfig() {
  const url = process.env.TIDB_DATABASE_URL;
  if (!url) return { error: "TIDB_DATABASE_URL is not set" as const };
  return { uri: url };
}

/**
 * GET /api/admin/tidb — ping TiDB and list HiClaw-related tables (admin only).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const cfg = getConnectionConfig();
  if ("error" in cfg) {
    return NextResponse.json({ ok: false, error: cfg.error }, { status: 503 });
  }

  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      uri: cfg.uri,
      ssl: { rejectUnauthorized: true },
    });
    await conn.query("SELECT 1 AS ok");

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('expert_status','sessions','waiting_room','evaluator_critiques')
       ORDER BY TABLE_NAME`
    );

    const tables = rows.map((r) => r.TABLE_NAME as string);

    return NextResponse.json({
      ok: true,
      message: "TiDB connection successful",
      hiclawTablesFound: tables,
      expectedTables: ["expert_status", "sessions", "waiting_room", "evaluator_critiques"],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/tidb GET]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

/**
 * POST /api/admin/tidb — apply HiClaw schema (idempotent CREATE IF NOT EXISTS).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  if (body.action !== "apply_hiclaw_schema") {
    return NextResponse.json(
      { error: 'Body must be JSON: { "action": "apply_hiclaw_schema" }' },
      { status: 400 }
    );
  }

  const cfg = getConnectionConfig();
  if ("error" in cfg) {
    return NextResponse.json({ ok: false, error: cfg.error }, { status: 503 });
  }

  let conn: mysql.Connection | null = null;
  const results: string[] = [];

  try {
    conn = await mysql.createConnection({
      uri: cfg.uri,
      ssl: { rejectUnauthorized: true },
    });

    for (const sql of HICLAW_TIDB_STATEMENTS) {
      try {
        await conn.query(sql);
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
    if (conn) await conn.end().catch(() => {});
  }
}

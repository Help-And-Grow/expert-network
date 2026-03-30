import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { Db9ApiError, db9FetchConnectionStringForDatabase } from "@/lib/db9-customer-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  action: z.enum(["get_connection_string", "reset_admin_password"]),
  /** DB9 Bearer token (from `db9 token show` after login). Sent once; not stored. */
  apiKey: z.string().min(16, "API key looks too short"),
  databaseName: z.preprocess((val) => {
    if (val === undefined || val === null) return "expert-network-hiclaw";
    if (typeof val !== "string") return val;
    const t = val.trim();
    return t.length === 0 ? "expert-network-hiclaw" : t;
  }, z.string().max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Invalid database name")),
});

/**
 * POST /api/admin/tidb/db9 — proxy to DB9 Customer API (admin only).
 * Returns a fresh postgresql:// URL to paste into Vercel as DB9_DATABASE_URL.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { action, apiKey, databaseName } = parsed.data;
  const mode = action === "reset_admin_password" ? "reset_password" : "current";

  try {
    const { databaseId, connectionString } = await db9FetchConnectionStringForDatabase(
      apiKey.trim(),
      databaseName,
      mode,
    );
    return NextResponse.json({
      ok: true,
      databaseId,
      databaseName,
      connectionString,
      reminder:
        "Copy the connection string into Vercel → DB9_DATABASE_URL (Production), save, then redeploy. Do not share this URL or commit it to git.",
    });
  } catch (e) {
    if (e instanceof Db9ApiError) {
      const status = e.status >= 400 && e.status < 600 ? e.status : 502;
      return NextResponse.json({ ok: false, error: e.message }, { status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/tidb/db9]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

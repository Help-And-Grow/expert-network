import { type NextRequest, NextResponse } from "next/server";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import {
  backfillAllExpertsMem9ToPgvector,
  backfillExpertMem9ToPgvector,
} from "@/lib/integrations/mem9-pgvector-backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/pgvector-backfill
 * Body: { "expertId"?: string } — omit expertId to run all experts with mem9SpaceId.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const expertId =
    typeof body.expertId === "string" ? body.expertId.trim() : "";

  try {
    if (expertId) {
      const r = await backfillExpertMem9ToPgvector(expertId);
      return NextResponse.json({ ok: true, ...r });
    }
    const r = await backfillAllExpertsMem9ToPgvector();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/pgvector-backfill]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

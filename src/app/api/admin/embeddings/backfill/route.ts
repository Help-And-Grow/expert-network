import { type NextRequest, NextResponse } from "next/server";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { backfillExpertProfileEmbeddings } from "@/lib/expert-search-embeddings";
import {
  resolveExpertSearchRegion,
  type ExpertSearchRegion,
} from "@/lib/expert-search-region";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseRegion(value: unknown): ExpertSearchRegion | undefined {
  if (value === "global" || value === "wechat-cn" || value === "wechat-intl") {
    return value;
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const rawBody = await request.json().catch(() => ({}));
  const body =
    typeof rawBody === "object" && rawBody !== null
      ? (rawBody as Record<string, unknown>)
      : {};
  const expertId =
    typeof body.expertId === "string" ? body.expertId.trim() : "";
  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(Math.round(body.limit), 500))
      : undefined;
  const region = parseRegion(body.region) ?? resolveExpertSearchRegion(request);

  try {
    const result = await backfillExpertProfileEmbeddings({
      expertId: expertId || undefined,
      limit,
      region,
    });
    return NextResponse.json({ ok: true, region, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/embeddings/backfill]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

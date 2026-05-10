import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { getExpertProfileEmbeddingCoverage } from "@/lib/expert-search-embeddings";
import { isExpertSearchVectorPrerankEnabled } from "@/lib/expert-match-search";
import {
  getStorageProvider,
  getActiveStorageProviderName,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * @deprecated Use `/api/admin/providers` instead. Kept for one release so
 * external scripts don't break. Phase 1 of the admin-page revamp.
 */
let warnedDeprecated = false;
function warnDeprecatedOnce() {
  if (warnedDeprecated) return;
  warnedDeprecated = true;
  console.warn(
    "[admin/system-config] DEPRECATED — use /api/admin/providers (Phase 1 revamp).",
  );
}

const bodySchema = z.object({
  STORAGE_PROVIDER: z.enum(["vercel", "gcs", "tencent-cos", "db"]).optional(),
  EXPERT_SEARCH_VECTOR_PRERANK: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  warnDeprecatedOnce();
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const storageProvider = await getActiveStorageProviderName();
  const provider = await getStorageProvider();
  const expertSearchCoverage = await getExpertProfileEmbeddingCoverage();

  return NextResponse.json({
    STORAGE_PROVIDER: storageProvider,
    EXPERT_SEARCH_VECTOR_PRERANK: await isExpertSearchVectorPrerankEnabled(),
    expertSearchCoverage,
    isConfigured: provider.isConfigured(),
  });
}

export async function POST(request: NextRequest) {
  warnDeprecatedOnce();
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { setSystemConfig } = await import("@/lib/system-config");

  if (parsed.data.STORAGE_PROVIDER) {
    await setSystemConfig("STORAGE_PROVIDER", parsed.data.STORAGE_PROVIDER);
  }
  if (typeof parsed.data.EXPERT_SEARCH_VECTOR_PRERANK === "boolean") {
    await setSystemConfig(
      "EXPERT_SEARCH_VECTOR_PRERANK",
      parsed.data.EXPERT_SEARCH_VECTOR_PRERANK ? "true" : "false",
    );
  }

  return NextResponse.json({
    ok: true,
    updated: parsed.data,
  });
}

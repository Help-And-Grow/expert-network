import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { getStorageProvider, getActiveStorageProviderName } from "@/lib/storage";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  STORAGE_PROVIDER: z.enum(["vercel", "gcs", "tencent-cos", "db"]).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const storageProvider = await getActiveStorageProviderName();
  const provider = await getStorageProvider();

  return NextResponse.json({
    STORAGE_PROVIDER: storageProvider,
    isConfigured: provider.isConfigured(),
  });
}

export async function POST(request: NextRequest) {
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

  return NextResponse.json({
    ok: true,
    updated: parsed.data,
  });
}

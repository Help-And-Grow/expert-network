import { type NextRequest, NextResponse } from "next/server";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import {
  getManagedVercelProjectConfig,
  triggerManagedProjectDeploy,
} from "@/lib/vercel-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Manually re-trigger a Vercel deploy after a successful DB apply whose
 * Vercel-sync phase failed. The atomic-apply route returns
 * `{ deployTriggered: false, deployError: '...' }` in that case; the
 * admin UI exposes a button that POSTs here.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const cfg = getManagedVercelProjectConfig();
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "Vercel managed project not configured" },
      { status: 400 },
    );
  }

  try {
    const deploy = await triggerManagedProjectDeploy(cfg);
    return NextResponse.json({ ok: true, deployTriggered: deploy.triggered });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        deployTriggered: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}

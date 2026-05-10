import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { getProvider } from "@/lib/admin/provider-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Phase 1 wires the endpoint; the live re-probe ("real 1-token completion"
 * for LLM, "HEAD on a known test key" for storage) lands in Phase 2 along
 * with the UI button. Today this returns a static health verdict based on
 * whether the registry row's required env keys are set in `process.env`.
 *
 * Response shape is forward-compatible with the Phase-2 implementation:
 *   { ok: boolean, latencyMs: number, error?: string }
 */
const bodySchema = z.object({
  category: z.string().min(1),
  key: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const startedAt = Date.now();
  const row = await getProvider(parsed.data.category, parsed.data.key);
  if (!row) {
    return NextResponse.json(
      {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: `Unknown provider: ${parsed.data.category}/${parsed.data.key}`,
      },
      { status: 404 },
    );
  }

  const requiredAny = (row.metadata?.requiredAny ?? []) as string[][];
  const present = (k: string) => Boolean(process.env[k]?.trim());
  const ok =
    requiredAny.length === 0 ||
    requiredAny.some((group) => group.length === 0 || group.every(present));

  return NextResponse.json({
    ok,
    latencyMs: Date.now() - startedAt,
    error: ok
      ? undefined
      : `Missing env keys (need any of: ${requiredAny
          .map((g) => g.join("+"))
          .join(" | ")})`,
    note: "Phase 1 stub — Phase 2 will issue a real ping.",
  });
}

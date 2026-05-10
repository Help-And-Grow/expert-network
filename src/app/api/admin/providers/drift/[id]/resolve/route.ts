import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { setSystemConfig } from "@/lib/system-config";
import {
  getManagedVercelProjectConfig,
  upsertManagedProjectEnv,
} from "@/lib/vercel-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({
  direction: z.enum(["push", "pull", "note"]),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/admin/providers/drift/:id/resolve
 *
 *   { direction: 'push' }  → write the DB value to Vercel project env
 *   { direction: 'pull' }  → write the Vercel value into SystemConfig
 *   { direction: 'note', note: '...' } → no write, just mark resolved
 *
 * All three mark the drift row as resolved with the actor email and an
 * optional note.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;

  const actor = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { email: true },
  });
  const actorEmail = actor?.email ?? null;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.format() },
      { status: 400 },
    );
  }

  const drift = await prisma.providerConfigDrift.findUnique({ where: { id } });
  if (!drift) {
    return NextResponse.json({ error: "Drift row not found" }, { status: 404 });
  }
  if (drift.resolved) {
    return NextResponse.json(
      { error: "Drift already resolved" },
      { status: 409 },
    );
  }

  const { direction, note } = parsed.data;

  if (direction === "push") {
    const cfg = getManagedVercelProjectConfig();
    if (!cfg) {
      return NextResponse.json(
        { error: "Vercel management not configured" },
        { status: 412 },
      );
    }
    if (drift.dbValue === null) {
      return NextResponse.json(
        { error: "Cannot push: DB value is null" },
        { status: 400 },
      );
    }
    try {
      await upsertManagedProjectEnv(cfg, drift.configKey, drift.dbValue);
    } catch (err) {
      return NextResponse.json(
        {
          error: "Vercel push failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      );
    }
  } else if (direction === "pull") {
    if (drift.vercelValue === null) {
      return NextResponse.json(
        { error: "Cannot pull: Vercel value is null" },
        { status: 400 },
      );
    }
    await setSystemConfig(drift.configKey, drift.vercelValue, drift.environment, {
      actorEmail,
      actorRole: "ADMIN",
      reason: `drift resolve (pull) ${note ? "— " + note : ""}`.trim(),
      category: "drift-resolve",
    });
  }
  // `note` direction: no side effects.

  const resolvedNote =
    direction === "note"
      ? note ?? "Marked as intentional"
      : `${direction === "push" ? "Pushed DB→Vercel" : "Pulled Vercel→DB"}${note ? " — " + note : ""}`;

  const updated = await prisma.providerConfigDrift.update({
    where: { id },
    data: {
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy: actorEmail,
      resolvedNote,
    },
  });

  return NextResponse.json({ ok: true, drift: updated });
}

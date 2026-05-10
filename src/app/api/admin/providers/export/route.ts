import { type NextRequest, NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { isSensitiveKey } from "@/lib/admin/cloud-regions";
import { prisma } from "@/lib/prisma";
import { resolveEnvironment } from "@/lib/system-config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/admin/providers/export?environment=production
 *
 * Returns a single JSON snapshot of the provider config for the env:
 * registry rows (global), system-config rows (env-scoped), routing
 * scopes and route overrides.
 *
 * Sensitive values (any key matching `*_API_KEY`, `*_SECRET`, etc.) are
 * redacted to `"***REDACTED***"` unless BOTH:
 *   - ?includeSecrets=true
 *   - X-Confirm-Sensitive: yes
 * are present. The header is checked separately so a CSRF/log leak of
 * the URL alone never leaks secrets.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const sp = request.nextUrl.searchParams;
  const environment = resolveEnvironment(sp.get("environment"));

  const includeSecretsRequested = sp.get("includeSecrets") === "true";
  const headerConfirmed =
    request.headers.get("x-confirm-sensitive") === "yes";
  const includeSecrets = includeSecretsRequested && headerConfirmed;

  if (includeSecretsRequested && !headerConfirmed) {
    return NextResponse.json(
      {
        error:
          "Including secrets requires the X-Confirm-Sensitive: yes request header.",
      },
      { status: 400 },
    );
  }

  const [registry, systemConfig, routingScopes, routeOverrides] =
    await Promise.all([
      prisma.providerRegistry.findMany({
        orderBy: [
          { category: "asc" },
          { sortOrder: "asc" },
          { key: "asc" },
        ],
      }),
      prisma.systemConfig.findMany({
        where: { environment },
        orderBy: { key: "asc" },
      }),
      prisma.providerRoutingScope.findMany({
        where: { environment },
        orderBy: [{ category: "asc" }, { priority: "asc" }],
      }),
      prisma.providerRouteOverride.findMany({
        where: { environment },
        orderBy: [{ category: "asc" }, { routePattern: "asc" }],
      }),
    ]);

  const redactedSystemConfig = systemConfig.map((row) => {
    if (!includeSecrets && isSensitiveKey(row.key)) {
      return { ...row, value: "***REDACTED***" };
    }
    return row;
  });

  // Best-effort audit: log the export so we can trace if secrets ever leak.
  const actor = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { email: true },
  });
  await prisma.providerConfigChange
    .create({
      data: {
        actorEmail: actor?.email ?? null,
        actorRole: "ADMIN",
        category: "export",
        configKey: "snapshot",
        environment,
        before: Prisma.JsonNull,
        after: {
          registryCount: registry.length,
          systemConfigCount: systemConfig.length,
          routingScopeCount: routingScopes.length,
          routeOverrideCount: routeOverrides.length,
          includeSecrets,
        },
        reason: includeSecrets
          ? "Exported with secrets (X-Confirm-Sensitive header)"
          : "Exported (secrets redacted)",
      },
    })
    .catch(() => undefined);

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    environment,
    includeSecrets,
    registry,
    systemConfig: redactedSystemConfig,
    routingScopes,
    routeOverrides,
  });
}

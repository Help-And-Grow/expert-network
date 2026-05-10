/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Vitest unit test for the atomic apply route.
 *
 * Asserts that when the Vercel sync fails AFTER the DB transaction commits,
 * the response correctly reports `deployTriggered: false` + a `deployError`,
 * and that audit rows for the changes already exist in the (mocked) DB.
 *
 * Vitest is not yet installed — see system-config.test.ts header.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditRows, systemConfig, fakePrisma, triggerDeployMock, upsertEnvMock } = vi.hoisted(() => {
  const auditRows: Array<Record<string, unknown>> = [];
  const systemConfig: Map<string, { value: string; environment: string }> = new Map();

  const fakeTx = {
    systemConfig: {
      findUnique: vi.fn(async ({ where }: any) => {
        const k = `${where.key_environment.environment}::${where.key_environment.key}`;
        const row = systemConfig.get(k);
        return row ? { key: where.key_environment.key, value: row.value, environment: row.environment } : null;
      }),
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const k = `${where.key_environment.environment}::${where.key_environment.key}`;
        systemConfig.set(k, {
          value: update.value ?? create.value,
          environment: where.key_environment.environment,
        });
        return { ...create, ...update };
      }),
    },
    providerRegistry: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: any) => ({
        id: "fake",
        ...create,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    providerConfigChange: {
      create: vi.fn(async ({ data }: any) => {
        auditRows.push(data);
        return { id: `a${auditRows.length}`, ...data };
      }),
    },
    providerRoutingScope: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async ({ create }: any) => ({
        id: "scope-fake",
        ...create,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    providerRouteOverride: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async ({ create }: any) => ({
        id: "override-fake",
        ...create,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      delete: vi.fn(async () => undefined),
    },
  };

  const fakePrisma = {
    ...fakeTx,
    $transaction: vi.fn(async (fn: (tx: typeof fakeTx) => Promise<unknown>) => {
      return fn(fakeTx);
    }),
    user: {
      findUnique: vi.fn(async () => ({ email: "admin@example.com" })),
    },
  };

  const triggerDeployMock = vi.fn();
  const upsertEnvMock = vi.fn();

  return { auditRows, systemConfig, fakePrisma, triggerDeployMock, upsertEnvMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: fakePrisma }));
vi.mock("@/generated/prisma/client", () => ({
  Prisma: { JsonNull: { __jsonNull: true } },
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn(async () => ({ userId: "u1" })),
  isErrorResponse: () => false,
}));

vi.mock("@/lib/ai/provider-catalog", () => ({
  ALL_VOICE_PROVIDERS: [],
  IMAGE_FALLBACK_ORDER: [],
  VOICE_FALLBACK_ORDER: [],
  computeProviderHealth: () => ({}),
  computeProviderHealthFromRuntime: () => ({}),
  getActiveAIProviderName: async () => "openai",
  getActiveImageProviderChain: async () => [],
  getActiveVoiceProviderChain: async () => [],
}));

vi.mock("@/lib/storage", () => ({
  getActiveStorageProviderName: async () => "vercel",
}));

vi.mock("@/lib/vercel-admin", () => ({
  getManagedVercelProjectConfig: () => ({
    project: "p",
    deployHookUrl: "https://example/h",
  }),
  listManagedProjectEnvs: async () => [],
  triggerManagedProjectDeploy: (...args: unknown[]) => triggerDeployMock(...args),
  upsertManagedProjectEnv: (...args: unknown[]) => upsertEnvMock(...args),
}));

import { POST } from "@/app/api/admin/providers/route";

function makeReq(body: unknown): any {
  return {
    json: async () => body,
    nextUrl: { searchParams: new URLSearchParams() },
  };
}

describe("/api/admin/providers POST — atomic apply", () => {
  beforeEach(() => {
    auditRows.length = 0;
    systemConfig.clear();
    vi.clearAllMocks();
  });

  it("commits DB even when Vercel deploy fails, returns deployTriggered=false", async () => {
    upsertEnvMock.mockResolvedValue(undefined);
    triggerDeployMock.mockRejectedValue(new Error("Deploy hook 503"));

    const res = await POST(
      makeReq({ activeLlm: "qwen", environment: "production" }),
    );
    const json = await (res as unknown as Response).json();

    expect(json.ok).toBe(true);
    expect(json.deployTriggered).toBe(false);
    expect(json.deployError).toMatch(/Deploy hook 503/);
    expect(json.updatedKeys).toContain("AI_PROVIDER");

    // DB write actually happened.
    expect(systemConfig.get("production::AI_PROVIDER")?.value).toBe("qwen");

    // Audit row exists.
    const auditForKey = auditRows.find(
      (r) => r.configKey === "AI_PROVIDER" && r.environment === "production",
    );
    expect(auditForKey).toBeTruthy();
    expect(auditForKey?.after).toBe("qwen");
    expect(auditForKey?.actorEmail).toBe("admin@example.com");
  });

  it("happy path: deployTriggered=true when Vercel sync succeeds", async () => {
    upsertEnvMock.mockResolvedValue(undefined);
    triggerDeployMock.mockResolvedValue({ triggered: true });

    const res = await POST(
      makeReq({ activeLlm: "openai", reason: "rotating key" }),
    );
    const json = await (res as unknown as Response).json();
    expect(json.deployTriggered).toBe(true);
    expect(json.deployError).toBe(null);

    const auditForKey = auditRows.find((r) => r.configKey === "AI_PROVIDER");
    expect(auditForKey?.reason).toBe("rotating key");
  });
});

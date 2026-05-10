/**
 * Vitest unit tests for system-config helpers (Phase 2).
 *
 * NOTE: Vitest is not yet installed in this repo (no `test` script,
 * no devDep). This file uses the stable Vitest API and `@ts-ignore`s
 * the import — it'll work once a follow-up installs the runner:
 *   npm install -D vitest
 *   npx vitest run src/lib/system-config.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store, auditRows, fakePrisma } = vi.hoisted(() => {
  type Row = { key: string; value: string; environment: string; updatedAt: Date };
  const store: Map<string, Row> = new Map();
  const auditRows: Array<Record<string, unknown>> = [];
  function k(key: string, env: string) {
    return `${env}::${key}`;
  }
  const fakePrisma = {
    systemConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key_environment: { key: string; environment: string } } }) => {
        return store.get(k(where.key_environment.key, where.key_environment.environment)) ?? null;
      }),
      upsert: vi.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { key_environment: { key: string; environment: string } };
          update: { value: string };
          create: { key: string; value: string; environment: string };
        }) => {
          const idx = k(where.key_environment.key, where.key_environment.environment);
          const existing = store.get(idx);
          if (existing) {
            existing.value = update.value;
            existing.updatedAt = new Date();
            return existing;
          }
          const row = { ...create, updatedAt: new Date() };
          store.set(idx, row);
          return row;
        },
      ),
      findMany: vi.fn(async () => Array.from(store.values())),
    },
    providerConfigChange: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data);
        return { id: `audit-${auditRows.length}`, ...data };
      }),
    },
  };
  return { store, auditRows, fakePrisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: fakePrisma }));
// `Prisma.JsonNull` import — supply a sentinel that the helper passes through.
vi.mock("@/generated/prisma/client", () => ({
  Prisma: { JsonNull: { __jsonNull: true } },
}));

import {
  __clearSystemConfigCache,
  getSystemConfig,
  resolveEnvironment,
  setSystemConfig,
} from "@/lib/system-config";

describe("system-config — Phase 2 env scoping & audit", () => {
  beforeEach(() => {
    store.clear();
    auditRows.length = 0;
    __clearSystemConfigCache();
    vi.clearAllMocks();
    delete process.env.VERCEL_ENV;
  });
  afterEach(() => {
    delete process.env.VERCEL_ENV;
  });

  it("resolveEnvironment defaults to production when VERCEL_ENV unset", () => {
    expect(resolveEnvironment()).toBe("production");
  });

  it("resolveEnvironment honors explicit overrides", () => {
    expect(resolveEnvironment("preview")).toBe("preview");
    expect(resolveEnvironment("development")).toBe("development");
  });

  it("resolveEnvironment uses VERCEL_ENV when present", () => {
    process.env.VERCEL_ENV = "preview";
    expect(resolveEnvironment()).toBe("preview");
  });

  it("setSystemConfig writes audit row and is env-scoped", async () => {
    await setSystemConfig("AI_PROVIDER", "openai", "production", {
      actorEmail: "alice@example.com",
    });
    expect(store.size).toBe(1);
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]).toMatchObject({
      configKey: "AI_PROVIDER",
      environment: "production",
      after: "openai",
      actorEmail: "alice@example.com",
      actorRole: "ADMIN",
    });

    // Same key in a different env should NOT collide.
    await setSystemConfig("AI_PROVIDER", "qwen", "preview");
    expect(store.size).toBe(2);
    expect(auditRows.length).toBe(2);
  });

  it("cache is invalidated per-env on writes", async () => {
    process.env.VERCEL_ENV = "production";
    await setSystemConfig("AI_PROVIDER", "openai");
    expect(await getSystemConfig("AI_PROVIDER")).toBe("openai");

    // Preview is independent.
    expect(await getSystemConfig("AI_PROVIDER", "preview")).toBe(null);
    await setSystemConfig("AI_PROVIDER", "qwen", "preview");
    expect(await getSystemConfig("AI_PROVIDER", "preview")).toBe("qwen");

    // Production unaffected.
    expect(await getSystemConfig("AI_PROVIDER")).toBe("openai");
  });

  it("does not write an audit row when the value didn't change", async () => {
    await setSystemConfig("AI_PROVIDER", "openai", "production");
    expect(auditRows.length).toBe(1);
    await setSystemConfig("AI_PROVIDER", "openai", "production");
    expect(auditRows.length).toBe(1); // no-op
  });
});

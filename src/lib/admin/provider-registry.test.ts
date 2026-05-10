/**
 * Vitest unit tests for the ProviderRegistry helper.
 *
 * NOTE: this repository does not yet have Vitest installed (see
 * package.json — no `test` script, no `vitest`/`jest` dep). This file is
 * authored against the standard Vitest API so it'll work as soon as the
 * test runner is added in a follow-up. To run today:
 *
 *   npm install -D vitest
 *   npx vitest run src/lib/admin/provider-registry.test.ts
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vitest is not yet installed; this import will resolve once
// the test runner is wired in (see file header). Suppressing type-check
// failure rather than dropping the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  category: string;
  key: string;
  displayName: string;
  enabled: boolean;
  envKeys: Record<string, string>;
  models: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

const fakeRows: Row[] = [
  {
    id: "1",
    category: "llm",
    key: "openai",
    displayName: "OpenAI",
    enabled: true,
    envKeys: { apiKey: "OPENAI_API_KEY" },
    models: { text: { default: "gpt-4o" } },
    metadata: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const findManyMock = vi.fn(async () => fakeRows);
const findUniqueMock = vi.fn(async () => fakeRows[0]);
const upsertMock = vi.fn(async (args: { create: Row }) => ({
  ...fakeRows[0],
  ...args.create,
}));
const updateMock = vi.fn(async () => fakeRows[0]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    providerRegistry: {
      findMany: findManyMock,
      findUnique: findUniqueMock,
      upsert: upsertMock,
      update: updateMock,
    },
  },
}));

describe("provider-registry", () => {
  beforeEach(async () => {
    findManyMock.mockClear();
    findUniqueMock.mockClear();
    upsertMock.mockClear();
    updateMock.mockClear();
    const { invalidateCache } = await import("./provider-registry");
    invalidateCache();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("listProviders caches reads within TTL", async () => {
    const { listProviders } = await import("./provider-registry");
    await listProviders("llm");
    await listProviders("llm");
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("listProviders bypasses cache with force:true", async () => {
    const { listProviders } = await import("./provider-registry");
    await listProviders("llm");
    await listProviders("llm", { force: true });
    expect(findManyMock).toHaveBeenCalledTimes(2);
  });

  it("getProvider returns a single row", async () => {
    const { getProvider } = await import("./provider-registry");
    const row = await getProvider("llm", "openai");
    expect(row?.key).toBe("openai");
    expect(findUniqueMock).toHaveBeenCalledOnce();
  });

  it("upsertProvider invalidates the list cache", async () => {
    const { listProviders, upsertProvider } = await import(
      "./provider-registry"
    );
    await listProviders("llm");
    await upsertProvider({
      category: "llm",
      key: "claude",
      displayName: "Anthropic Claude",
      envKeys: { apiKey: "ANTHROPIC_API_KEY" },
    });
    await listProviders("llm");
    // 2 reads total — cache was invalidated by the upsert.
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(upsertMock).toHaveBeenCalledOnce();
  });

  it("listProviders returns [] on DB failure (boot-resilience)", async () => {
    findManyMock.mockRejectedValueOnce(new Error("connection refused"));
    const { listProviders } = await import("./provider-registry");
    const rows = await listProviders("llm", { force: true });
    expect(rows).toEqual([]);
  });
});

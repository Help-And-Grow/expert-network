/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Vitest unit tests for the Phase 3 routing resolver.
 * Vitest is not yet installed in this repo (see other *.test.ts headers);
 * the file is type-checked and ready to run once it is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeScope = {
  id: string;
  scopeKey: string;
  displayName: string;
  description: string | null;
  category: string;
  chain: string[];
  enabled: boolean;
  matchRules: Record<string, unknown>;
  priority: number;
  environment: string;
  createdAt: Date;
  updatedAt: Date;
};

type FakeOverride = {
  id: string;
  routePattern: string;
  category: string;
  chainOverride: string[];
  enabled: boolean;
  reason: string | null;
  environment: string;
  createdAt: Date;
  updatedAt: Date;
};

const { scopes, overrides, state, fakePrisma } = vi.hoisted(() => {
  type FakeScopeH = {
    id: string;
    scopeKey: string;
    displayName: string;
    description: string | null;
    category: string;
    chain: string[];
    enabled: boolean;
    matchRules: Record<string, unknown>;
    priority: number;
    environment: string;
    createdAt: Date;
    updatedAt: Date;
  };
  type FakeOverrideH = {
    id: string;
    routePattern: string;
    category: string;
    chainOverride: string[];
    enabled: boolean;
    reason: string | null;
    environment: string;
    createdAt: Date;
    updatedAt: Date;
  };
  const scopes: FakeScopeH[] = [];
  const overrides: FakeOverrideH[] = [];
  const state = { scopeFindFails: false };
  const fakePrisma = {
    providerRoutingScope: {
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        if (state.scopeFindFails) throw new Error("DB unreachable");
        return scopes
          .filter(
            (s) =>
              s.category === where.category &&
              s.environment === where.environment &&
              (where.enabled === undefined || s.enabled === where.enabled),
          )
          .sort((a, b) => {
            if (Array.isArray(orderBy)) {
              for (const o of orderBy) {
                const k = Object.keys(o)[0] as keyof FakeScopeH;
                if (a[k] !== b[k]) {
                  return (a[k] as any) < (b[k] as any) ? -1 : 1;
                }
              }
            }
            return 0;
          });
      }),
    },
    providerRouteOverride: {
      findMany: vi.fn(async ({ where }: any) =>
        overrides.filter(
          (o) =>
            o.category === where.category &&
            o.environment === where.environment &&
            (where.enabled === undefined || o.enabled === where.enabled),
        ),
      ),
    },
  };
  return { scopes, overrides, state, fakePrisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: fakePrisma }));
vi.mock("@/generated/prisma/client", () => ({
  Prisma: { JsonNull: { __jsonNull: true } },
}));

import {
  invalidateRoutingCache,
  matchesRoutePattern,
  matchesScope,
  resolveChainForRequest,
} from "@/lib/ai/routing";

function pushScope(s: Partial<FakeScope>): void {
  scopes.push({
    id: `s${scopes.length}`,
    scopeKey: "test",
    displayName: "Test",
    description: null,
    category: "llm",
    chain: [],
    enabled: true,
    matchRules: {},
    priority: 100,
    environment: "production",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...s,
  });
}

function pushOverride(o: Partial<FakeOverride>): void {
  overrides.push({
    id: `o${overrides.length}`,
    routePattern: "/api/match",
    category: "llm",
    chainOverride: [],
    enabled: true,
    reason: null,
    environment: "production",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  });
}

describe("routing resolver", () => {
  beforeEach(() => {
    scopes.length = 0;
    overrides.length = 0;
    state.scopeFindFails = false;
    invalidateRoutingCache();
    vi.clearAllMocks();
  });

  it("WeChat-Intl origin picks the wechat-intl scope", async () => {
    pushScope({
      scopeKey: "web-default",
      chain: ["qwen", "gemini"],
      matchRules: {},
      priority: 200,
    });
    pushScope({
      scopeKey: "wechat-intl",
      chain: ["hunyuan"],
      matchRules: { isWeChat: true, region: "intl" },
      priority: 100,
    });
    pushScope({
      scopeKey: "wechat-cn",
      chain: ["hunyuan"],
      matchRules: { isWeChat: true, region: "cn" },
      priority: 100,
    });

    const result = await resolveChainForRequest(
      "llm",
      { isWeChat: true, region: "intl" },
      "production",
      { fallback: () => ["FALLBACK"] },
    );
    expect(result).toEqual(["hunyuan"]);
  });

  it("Web origin (non-WeChat) picks the web-default catch-all scope", async () => {
    pushScope({
      scopeKey: "web-default",
      chain: ["qwen", "gemini"],
      matchRules: {},
      priority: 200,
    });
    pushScope({
      scopeKey: "wechat-intl",
      chain: ["hunyuan"],
      matchRules: { isWeChat: true, region: "intl" },
      priority: 100,
    });

    const result = await resolveChainForRequest(
      "llm",
      { isWeChat: false },
      "production",
      { fallback: () => ["FALLBACK"] },
    );
    expect(result).toEqual(["qwen", "gemini"]);
  });

  it("route override beats scope chain", async () => {
    pushScope({
      scopeKey: "web-default",
      chain: ["qwen", "gemini"],
      matchRules: {},
      priority: 200,
    });
    pushOverride({
      routePattern: "/api/match",
      chainOverride: ["openai"],
    });

    const result = await resolveChainForRequest(
      "llm",
      { isWeChat: false, routePath: "/api/match" },
      "production",
      { fallback: () => ["FALLBACK"] },
    );
    expect(result).toEqual(["openai"]);
  });

  it("DB read failure returns the caller-provided fallback", async () => {
    state.scopeFindFails = true;
    const result = await resolveChainForRequest(
      "llm",
      { isWeChat: false },
      "production",
      { fallback: () => ["LEGACY-A", "LEGACY-B"] },
    );
    expect(result).toEqual(["LEGACY-A", "LEGACY-B"]);
  });

  it("matchesScope: empty rules = catch-all", () => {
    expect(matchesScope({}, { isWeChat: false })).toBe(true);
    expect(matchesScope({}, { isWeChat: true, region: "intl" })).toBe(true);
  });

  it("matchesScope: region must equal", () => {
    expect(
      matchesScope(
        { isWeChat: true, region: "intl" },
        { isWeChat: true, region: "cn" },
      ),
    ).toBe(false);
  });

  it("matchesRoutePattern: exact + wildcard", () => {
    expect(matchesRoutePattern("/api/match", "/api/match")).toBe(true);
    expect(matchesRoutePattern("/api/match/foo", "/api/match")).toBe(false);
    expect(matchesRoutePattern("/api/voice-chat/abc", "/api/voice-chat/*")).toBe(
      true,
    );
    expect(matchesRoutePattern("/api/voice-chat", "/api/voice-chat/*")).toBe(
      false,
    );
  });
});

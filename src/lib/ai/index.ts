/* eslint-disable @typescript-eslint/consistent-type-imports */
import type { AIProvider } from "./types";

export type {
  ProfileInput,
  ProfileOutput,
  ImageInput,
  MatchResult,
  NormalizedQuery,
  ServiceItem,
} from "./types";

// ---------------------------------------------------------------------------
// Provider registry — add new providers here
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, () => AIProvider> = {
  dedalus: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DedalusProvider } = require("./dedalus") as typeof import("./dedalus");
    return new DedalusProvider();
  },
  gemini: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GeminiProvider } = require("./gemini") as typeof import("./gemini");
    return new GeminiProvider();
  },
  hunyuan: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HunyuanProvider } = require("./hunyuan") as typeof import("./hunyuan");
    return new HunyuanProvider();
  },
  qwen: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { QwenProvider } = require("./qwen") as typeof import("./qwen");
    return new QwenProvider();
  },
  openai: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OpenAIProvider } = require("./openai") as typeof import("./openai");
    return new OpenAIProvider();
  },
  zai: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ZAIProvider } = require("./zai") as typeof import("./zai");
    return new ZAIProvider();
  },
  byteplus: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BytePlusProvider } = require("./byteplus") as typeof import("./byteplus");
    return new BytePlusProvider();
  },
  volcengine: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VolcengineProvider } = require("./volcengine") as typeof import("./volcengine");
    return new VolcengineProvider();
  },
};

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

const _byName = new Map<string, AIProvider>();

function resolveByName(name: string): AIProvider {
  const cached = _byName.get(name);
  if (cached) return cached;
  const factory = PROVIDERS[name];
  if (!factory) {
    throw new Error(
      `Unknown AI_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  const instance = factory();
  _byName.set(name, instance);
  return instance;
}

async function provider(): Promise<AIProvider> {
  const { getActiveAIProviderName } = await import("./provider-catalog");
  const name = await getActiveAIProviderName();
  return resolveByName(name);
}

type RequestContext = {
  request?: { headers: { get(name: string): string | null } } | null;
};

/**
 * Region-aware provider resolution. WeChat-originated requests are routed to
 * the configured `WECHAT_AI_PROVIDER` (defaults to Qwen via DashScope) so the
 * inference endpoint stays inside the GFW boundary. Everything else falls
 * back to the global default.
 */
export async function resolveAIProvider(
  ctx: RequestContext = {},
): Promise<AIProvider> {
  const { getActiveAIProviderNameForRequest } = await import("./provider-catalog");
  const name = await getActiveAIProviderNameForRequest(ctx.request ?? null);
  return resolveByName(name);
}

/** One-off provider instance (e.g. vendor demo overrides) — does not use the env singleton. */
export function createAIProviderForName(name: string): AIProvider {
  const n = name.trim().toLowerCase();
  const factory = PROVIDERS[n];
  if (!factory) {
    throw new Error(
      `Unknown AI provider "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return factory();
}

// ---------------------------------------------------------------------------
// Public API — unchanged, consumers keep importing these functions
// ---------------------------------------------------------------------------

export async function generateExpertProfile(
  ...args: Parameters<AIProvider["generateExpertProfile"]>
) {
  return (await provider()).generateExpertProfile(...args);
}

export async function generateProfileImage(
  ...args: Parameters<AIProvider["generateProfileImage"]>
) {
  return (await provider()).generateProfileImage(...args);
}

export async function improveWriting(
  ...args: Parameters<AIProvider["improveWriting"]>
) {
  return (await provider()).improveWriting(...args);
}

export async function normalizeQuery(
  ...args: Parameters<AIProvider["normalizeQuery"]>
) {
  return (await provider()).normalizeQuery(...args);
}

export async function matchExperts(
  ...args: Parameters<AIProvider["matchExperts"]>
) {
  return (await provider()).matchExperts(...args);
}

export async function extractTextFromPdf(
  ...args: Parameters<AIProvider["extractTextFromPdf"]>
) {
  return (await provider()).extractTextFromPdf(...args);
}

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

/**
 * Default provider for utility functions (improveWriting, generateExpertProfile,
 * normalizeQuery, generateProfileImage). Uses the same chain as `chat()` so the
 * AI_TEXT_PROVIDER_CHAIN (env or SystemConfig) is honoured uniformly —
 * historically this only honored AI_PROVIDER, which created an asymmetry where
 * a deployment with `AI_TEXT_PROVIDER_CHAIN=gemini` (e.g. the Help-And-Grow
 * Cloud Run target) would still try Qwen for the single-provider paths and 401
 * because no DASHSCOPE_API_KEY is set. Chain semantics: try each in order,
 * first to succeed wins; identical behaviour for single-element chains.
 *
 * Request context is `null` because these call sites don't carry an inbound
 * Request — that's only used for WeChat region detection, which doesn't apply
 * to these server-side flows.
 */
async function provider(): Promise<AIProvider> {
  return resolveAIProvider({});
}

type RequestContext = {
  request?: { headers: { get(name: string): string | null } } | null;
};

/**
 * Wrap a list of providers so each `AIProvider` method tries them in order
 * and returns the first one that succeeds. If every provider throws, the
 * final error from the last attempt is re-thrown so the caller can surface
 * the actual upstream cause (rate-limit message, auth error, etc.).
 *
 * Logs each fallback so operators can spot when the chain is degrading.
 */
function chainProviders(chain: AIProvider[], chainNames: string[]): AIProvider {
  if (chain.length === 0) {
    throw new Error(
      "Cannot build empty AI provider chain — at least one provider must be configured.",
    );
  }
  if (chain.length === 1) return chain[0];

  async function tryEach<T>(
    label: string,
    fn: (p: AIProvider) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < chain.length; i++) {
      try {
        return await fn(chain[i]);
      } catch (error) {
        lastError = error;
        const next = chainNames[i + 1];
        const msg = error instanceof Error ? error.message : String(error);
        if (next) {
          console.warn(
            `[ai] ${label} failed on "${chainNames[i]}" — falling back to "${next}". Cause: ${msg}`,
          );
        } else {
          console.error(
            `[ai] ${label} failed on "${chainNames[i]}" (final provider in chain). Cause: ${msg}`,
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(
          `[ai] ${label}: all providers in chain [${chainNames.join(", ")}] failed`,
        );
  }

  return {
    generateExpertProfile: (data) =>
      tryEach("generateExpertProfile", (p) => p.generateExpertProfile(data)),
    generateProfileImage: (data) =>
      tryEach("generateProfileImage", (p) => p.generateProfileImage(data)),
    improveWriting: (type, content) =>
      tryEach("improveWriting", (p) => p.improveWriting(type, content)),
    normalizeQuery: (query) =>
      tryEach("normalizeQuery", (p) => p.normalizeQuery(query)),
    matchExperts: (query, experts, history, normalised) =>
      tryEach("matchExperts", (p) =>
        p.matchExperts(query, experts, history, normalised),
      ),
    extractTextFromPdf: (buffer) =>
      tryEach("extractTextFromPdf", (p) => p.extractTextFromPdf(buffer)),
  };
}

/**
 * Region-aware provider resolution with built-in cross-cloud fallback.
 *
 * - WeChat-originated requests → Hunyuan (single-provider chain by design;
 *   no cross-cloud fallback to keep inference inside the Tencent compliance
 *   boundary — see architecture.md §3.2).
 * - Web / Telegram / REST → Qwen primary → Gemini fallback (configurable
 *   via SystemConfig `AI_TEXT_PROVIDER_CHAIN`).
 *
 * Every public AIProvider method on the returned façade tries each provider
 * in order until one succeeds, so individual route handlers don't need their
 * own try/catch fallback logic.
 */
export async function resolveAIProvider(
  ctx: RequestContext = {},
): Promise<AIProvider> {
  const { getActiveAIProviderChainForRequest } = await import("./provider-catalog");
  const names = await getActiveAIProviderChainForRequest(ctx.request ?? null);
  const chain = names.map(resolveByName);
  return chainProviders(chain, names);
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

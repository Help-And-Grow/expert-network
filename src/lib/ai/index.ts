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

let _provider: AIProvider | null = null;

async function provider(): Promise<AIProvider> {
  if (!_provider) {
    const { getActiveAIProviderName } = await import("./provider-catalog");
    const name = await getActiveAIProviderName();
    const factory = PROVIDERS[name];
    if (!factory) {
      throw new Error(
        `Unknown AI_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`
      );
    }
    _provider = factory();
  }
  return _provider;
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

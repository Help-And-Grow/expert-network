/* eslint-disable @typescript-eslint/consistent-type-imports */
import { env } from "@/lib/env";
import type { AIProvider } from "./types";

export type {
  ProfileInput,
  ProfileOutput,
  ImageInput,
  MatchResult,
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
};

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _provider: AIProvider | null = null;

function provider(): AIProvider {
  if (!_provider) {
    const name = env.AI_PROVIDER || "qwen";
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

// ---------------------------------------------------------------------------
// Public API — unchanged, consumers keep importing these functions
// ---------------------------------------------------------------------------

export function generateExpertProfile(
  ...args: Parameters<AIProvider["generateExpertProfile"]>
) {
  return provider().generateExpertProfile(...args);
}

export function generateProfileImage(
  ...args: Parameters<AIProvider["generateProfileImage"]>
) {
  return provider().generateProfileImage(...args);
}

export function improveWriting(
  ...args: Parameters<AIProvider["improveWriting"]>
) {
  return provider().improveWriting(...args);
}

export function matchExperts(
  ...args: Parameters<AIProvider["matchExperts"]>
) {
  return provider().matchExperts(...args);
}

export function extractTextFromPdf(
  ...args: Parameters<AIProvider["extractTextFromPdf"]>
) {
  return provider().extractTextFromPdf(...args);
}

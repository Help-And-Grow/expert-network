import { env } from "@/lib/env";

/**
 * Hard-coded fallback list. Used at boot when the `ProviderRegistry` table
 * is unreachable (cold start before migrations apply, or DB outage).
 * Keep in sync with the seed in `src/lib/admin/provider-registry-seed.ts`.
 *
 * Phase 1 of the admin-page revamp moved the source of truth into
 * `ProviderRegistry`; this constant is now a safety net.
 */
export const FALLBACK_LLM_PROVIDERS = [
  "openai",
  "zai",
  "qwen",
  "gemini",
  "hunyuan",
  "byteplus",
  "volcengine",
] as const;

/**
 * Static narrow union of providers known at compile time. New providers
 * added via the registry are valid at runtime but not present in this
 * type — admin code paths should treat unknown registry keys as a
 * runtime extension point. Phase 2 will widen this to `string`.
 */
export const ALL_AI_PROVIDERS = FALLBACK_LLM_PROVIDERS;

export type AIProviderName = (typeof FALLBACK_LLM_PROVIDERS)[number];

let warnedRegistryFallback = false;

/**
 * Registry-first list of active LLM provider keys. Falls back to
 * `FALLBACK_LLM_PROVIDERS` (and logs once) if the registry is unreachable
 * or empty. Returned strings may include keys outside the static
 * `AIProviderName` union — callers should validate before narrowing.
 */
export async function listAllAIProviderNames(): Promise<string[]> {
  try {
    const { listProviders } = await import("@/lib/admin/provider-registry");
    const rows = await listProviders("llm", { enabledOnly: true });
    if (rows.length > 0) return rows.map((r) => r.key);
  } catch (err) {
    if (!warnedRegistryFallback) {
      console.warn(
        "[provider-catalog] ProviderRegistry unavailable, using FALLBACK_LLM_PROVIDERS:",
        err instanceof Error ? err.message : err,
      );
      warnedRegistryFallback = true;
    }
    return [...FALLBACK_LLM_PROVIDERS];
  }
  if (!warnedRegistryFallback) {
    console.warn(
      "[provider-catalog] ProviderRegistry empty, using FALLBACK_LLM_PROVIDERS",
    );
    warnedRegistryFallback = true;
  }
  return [...FALLBACK_LLM_PROVIDERS];
}

/**
 * Default profile-image chain. Tried in order; first to return an image wins.
 * Operators can override at runtime via SystemConfig key
 * `IMAGE_PROVIDER_CHAIN` (comma-separated, e.g. "qwen,gemini") without a
 * redeploy — see `getActiveImageProviderChain()`.
 */
export const IMAGE_FALLBACK_ORDER = ["qwen", "gemini"] as const;

/**
 * Default text-provider chain for non-WeChat surfaces (Web, Telegram, REST API).
 * Qwen primary, Gemini fallback. See architecture.md §3.2 for the rationale —
 * tl;dr: Qwen is co-located in `ap-southeast-1` for low latency from our
 * Vercel `sin1` functions, Gemini is the cross-cloud safety net.
 *
 * Operators can override at runtime via SystemConfig key
 * `AI_TEXT_PROVIDER_CHAIN` (comma-separated, e.g. "qwen,gemini,openai").
 */
export const DEFAULT_WEB_TEXT_CHAIN = ["qwen", "gemini"] as const;

/**
 * Default voice-synthesis chain. Tokens map to TTS providers, not text
 * providers (e.g. `qwen-tts` uses DashScope CosyVoice). Override at runtime
 * via SystemConfig key `VOICE_PROVIDER_CHAIN` or the routing scopes UI.
 *
 * Phase 3: voice is no longer capped to a static union — the registry is
 * the source of truth (rows where `metadata.capabilities` includes "voice").
 * `ALL_VOICE_PROVIDERS` remains as a hard-coded boot fallback for cold
 * starts before the registry is reachable.
 */
export const ALL_VOICE_PROVIDERS = [
  "qwen-tts",
  "gemini-tts",
  "openai-tts",
  "hunyuan-tts",
] as const;
/**
 * Voice provider keys are runtime-extensible (see `listProviders('llm', { ... })`
 * filtered by `capabilities: ["voice"]`). This type stays narrow for the
 * legacy fallback path; admin-driven keys are typed as `string`.
 */
export type VoiceProviderName = string;
export const VOICE_FALLBACK_ORDER: readonly string[] = ["qwen-tts", "gemini-tts"];

type ModelEnvKey =
  | "OPENAI_TEXT_MODEL"
  | "OPENAI_IMAGE_MODEL"
  | "ZAI_TEXT_MODEL"
  | "ZAI_IMAGE_MODEL"
  | "QWEN_TEXT_MODEL"
  | "QWEN_IMAGE_MODEL"
  | "GEMINI_TEXT_MODEL"
  | "GEMINI_IMAGE_MODEL"
  | "HUNYUAN_TEXT_MODEL"
  | "BYTEPLUS_MODEL_ID"
  | "BYTEPLUS_IMAGE_MODEL"
  | "VOLCENGINE_MODEL_ID"
  | "VOLCENGINE_IMAGE_MODEL";

export type ProviderRequirement = {
  requiredAny: string[][];
  optional: string[];
};

export type ProviderCatalogEntry = ProviderRequirement & {
  label: string;
  description: string;
  textModelEnvKey?: ModelEnvKey;
  imageModelEnvKey?: ModelEnvKey;
  defaultTextModel?: string;
  defaultImageModel?: string;
  supportsImage: boolean;
};

export const OPENAI_DEFAULT_TEXT_MODEL = "gpt-5.2";
export const OPENAI_DEFAULT_IMAGE_MODEL = "gpt-image-1.5";
export const ZAI_DEFAULT_TEXT_MODEL = "glm-5.1";
export const ZAI_DEFAULT_VERTEX_TEXT_MODEL = "glm-5-maas";
export const ZAI_DEFAULT_IMAGE_MODEL = "glm-image";
export const QWEN_DEFAULT_TEXT_MODEL = "qwen3.6-plus";
export const QWEN_DEFAULT_IMAGE_MODEL = "wan2.7-image-pro";
export const GEMINI_DEFAULT_TEXT_MODEL = "gemini-3.1-flash";
export const GEMINI_DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
export const HUNYUAN_DEFAULT_TEXT_MODEL = "hunyuan-turbo";
export const BYTEPLUS_DEFAULT_TEXT_MODEL = "doubao-seed-1.6-flash";
export const BYTEPLUS_DEFAULT_IMAGE_MODEL = "doubao-seedream-4.0-flash";
export const VOLCENGINE_DEFAULT_TEXT_MODEL = "doubao-seed-1.6-flash";
export const VOLCENGINE_DEFAULT_IMAGE_MODEL = "doubao-seedream-4.0-flash";

export const AI_PROVIDER_CATALOG: Record<AIProviderName, ProviderCatalogEntry> = {
  openai: {
    label: "OpenAI",
    description: "General-purpose frontier text and image generation.",
    requiredAny: [["OPENAI_API_KEY"]],
    optional: [],
    textModelEnvKey: "OPENAI_TEXT_MODEL",
    imageModelEnvKey: "OPENAI_IMAGE_MODEL",
    defaultTextModel: OPENAI_DEFAULT_TEXT_MODEL,
    defaultImageModel: OPENAI_DEFAULT_IMAGE_MODEL,
    supportsImage: true,
  },
  zai: {
    label: "Z.AI / GLM",
    description: "GLM text and image generation via direct API or Vertex partner routing.",
    requiredAny: [["ZAI_API_KEY"], ["GOOGLE_CLOUD_PROJECT", "GOOGLE_SERVICE_ACCOUNT_KEY"]],
    optional: ["ZAI_BASE_URL", "ZAI_VERTEX_LOCATION"],
    textModelEnvKey: "ZAI_TEXT_MODEL",
    imageModelEnvKey: "ZAI_IMAGE_MODEL",
    defaultTextModel: ZAI_DEFAULT_TEXT_MODEL,
    defaultImageModel: ZAI_DEFAULT_IMAGE_MODEL,
    supportsImage: true,
  },
  qwen: {
    label: "Qwen / DashScope",
    description: "Alibaba Cloud Qwen text with Wan image generation.",
    requiredAny: [["DASHSCOPE_API_KEY"]],
    optional: ["VOICE_CHAT_DEFAULT_VOICE"],
    textModelEnvKey: "QWEN_TEXT_MODEL",
    imageModelEnvKey: "QWEN_IMAGE_MODEL",
    defaultTextModel: QWEN_DEFAULT_TEXT_MODEL,
    defaultImageModel: QWEN_DEFAULT_IMAGE_MODEL,
    supportsImage: true,
  },
  gemini: {
    label: "Gemini / Vertex AI",
    description: "Google Gemini text and image generation via Vertex AI.",
    requiredAny: [["GOOGLE_CLOUD_PROJECT", "GOOGLE_SERVICE_ACCOUNT_KEY"]],
    optional: ["GOOGLE_CLOUD_LOCATION", "GEMINI_IMAGE_VERTEX_LOCATION"],
    textModelEnvKey: "GEMINI_TEXT_MODEL",
    imageModelEnvKey: "GEMINI_IMAGE_MODEL",
    defaultTextModel: GEMINI_DEFAULT_TEXT_MODEL,
    defaultImageModel: GEMINI_DEFAULT_IMAGE_MODEL,
    supportsImage: true,
  },
  hunyuan: {
    label: "Tencent Hunyuan",
    description:
      "Tencent Cloud Hunyuan LLM. Default for the WeChat-CN and WeChat-Intl stacks (data residency on Tencent infrastructure).",
    requiredAny: [["HUNYUAN_API_KEY"]],
    optional: [],
    textModelEnvKey: "HUNYUAN_TEXT_MODEL",
    defaultTextModel: HUNYUAN_DEFAULT_TEXT_MODEL,
    supportsImage: false,
  },
  byteplus: {
    label: "BytePlus / Dola",
    description:
      "OpenAI-compatible Dola text + Seedream image generation via BytePlus (ap-southeast.bytepluses.com — for overseas / international deployments).",
    requiredAny: [["BYTEPLUS_API_KEY"]],
    optional: [],
    textModelEnvKey: "BYTEPLUS_MODEL_ID",
    imageModelEnvKey: "BYTEPLUS_IMAGE_MODEL",
    defaultTextModel: BYTEPLUS_DEFAULT_TEXT_MODEL,
    defaultImageModel: BYTEPLUS_DEFAULT_IMAGE_MODEL,
    supportsImage: true,
  },
  volcengine: {
    label: "Volcengine / Doubao",
    description:
      "OpenAI-compatible Doubao text + Seedream image generation via Volcano Engine ARK (ark.cn-beijing.volces.com — for mainland China deployments). Activate models in the VeArk console first.",
    requiredAny: [["VOLCENGINE_API_KEY"]],
    optional: [],
    textModelEnvKey: "VOLCENGINE_MODEL_ID",
    imageModelEnvKey: "VOLCENGINE_IMAGE_MODEL",
    defaultTextModel: VOLCENGINE_DEFAULT_TEXT_MODEL,
    defaultImageModel: VOLCENGINE_DEFAULT_IMAGE_MODEL,
    supportsImage: true,
  },
};

function getModelEnvValue(key?: ModelEnvKey): string | undefined {
  switch (key) {
    case "OPENAI_TEXT_MODEL":
      return env.OPENAI_TEXT_MODEL?.trim();
    case "OPENAI_IMAGE_MODEL":
      return env.OPENAI_IMAGE_MODEL?.trim();
    case "ZAI_TEXT_MODEL":
      return env.ZAI_TEXT_MODEL?.trim();
    case "ZAI_IMAGE_MODEL":
      return env.ZAI_IMAGE_MODEL?.trim();
    case "QWEN_TEXT_MODEL":
      return env.QWEN_TEXT_MODEL?.trim();
    case "QWEN_IMAGE_MODEL":
      return env.QWEN_IMAGE_MODEL?.trim();
    case "GEMINI_TEXT_MODEL":
      return env.GEMINI_TEXT_MODEL?.trim();
    case "GEMINI_IMAGE_MODEL":
      return env.GEMINI_IMAGE_MODEL?.trim();
    case "HUNYUAN_TEXT_MODEL":
      return env.HUNYUAN_TEXT_MODEL?.trim();
    case "BYTEPLUS_MODEL_ID":
      return env.BYTEPLUS_MODEL_ID?.trim();
    case "BYTEPLUS_IMAGE_MODEL":
      return env.BYTEPLUS_IMAGE_MODEL?.trim();
    case "VOLCENGINE_MODEL_ID":
      return env.VOLCENGINE_MODEL_ID?.trim();
    case "VOLCENGINE_IMAGE_MODEL":
      return env.VOLCENGINE_IMAGE_MODEL?.trim();
    default:
      return undefined;
  }
}

export function normalizeAIProviderName(
  value?: string | null,
): AIProviderName | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return ALL_AI_PROVIDERS.find((provider) => provider === normalized) ?? null;
}

export async function getActiveAIProviderName(): Promise<AIProviderName> {
  const { getSystemConfig } = await import("@/lib/system-config");
  const dbProvider = await getSystemConfig("AI_PROVIDER");
  return normalizeAIProviderName(dbProvider || env.AI_PROVIDER) ?? "gemini";
}

/**
 * Region-aware provider resolution.
 *
 * - WeChat-originated requests (stamped by the TCB proxy) use the
 *   `WECHAT_AI_PROVIDER` SystemConfig / env, defaulting to `hunyuan` so the
 *   inference call stays inside the Tencent compliance boundary.
 * - All other traffic uses the default `getActiveAIProviderName()`.
 *
 * NOTE: This returns a SINGLE provider name. For fallback-aware resolution,
 * use `getActiveAIProviderChainForRequest()` below.
 */
export async function getActiveAIProviderNameForRequest(
  request: { headers: { get(name: string): string | null } } | null | undefined,
): Promise<AIProviderName> {
  const { isWeChatOriginatedRequest } = await import("@/lib/request-origin");
  if (!isWeChatOriginatedRequest(request ?? null)) {
    return getActiveAIProviderName();
  }
  const { getSystemConfig } = await import("@/lib/system-config");
  const dbProvider = await getSystemConfig("WECHAT_AI_PROVIDER");
  const resolved = normalizeAIProviderName(
    dbProvider || env.WECHAT_AI_PROVIDER || "hunyuan",
  );
  return resolved ?? "hunyuan";
}

/**
 * Per-surface provider chain. Phase 3: delegates to `resolveChainForRequest`
 * which reads `ProviderRoutingScope` rows from the DB and falls back to the
 * legacy env-driven path below when scopes are unreachable / unmatched.
 *
 * Legacy fallback (when no scope matches and DB is reachable):
 * - WeChat-originated requests → `[hunyuan]` (no cross-cloud fallback by
 *   design — see architecture.md §3.2 "Why no cross-cloud fallback for
 *   WeChat").
 * - All other traffic → SystemConfig `AI_TEXT_PROVIDER_CHAIN` →
 *   env `AI_TEXT_PROVIDER_CHAIN` → `DEFAULT_WEB_TEXT_CHAIN` (`qwen,gemini`).
 *
 * Returns at least one provider name. Signature unchanged — callers stay sync.
 */
export async function getActiveAIProviderChainForRequest(
  request: { headers: { get(name: string): string | null } } | null | undefined,
): Promise<AIProviderName[]> {
  const { isWeChatOriginatedRequest, getWeChatRegion } = await import(
    "@/lib/request-origin"
  );
  const { resolveChainForRequest } = await import("./routing");
  const isWeChat = isWeChatOriginatedRequest(request ?? null);
  const region = getWeChatRegion(request ?? null);
  const routePath = extractRoutePath(request);

  const resolved = await resolveChainForRequest(
    "llm",
    {
      isWeChat,
      region: region ?? undefined,
      routePath,
      userAgent: request?.headers.get("user-agent") ?? undefined,
    },
    null,
    {
      fallback: () => legacyTextChainFallback(request, isWeChat),
    },
  );
  return narrowToKnown(resolved, ALL_AI_PROVIDERS, "qwen");
}

async function legacyTextChainFallback(
  request: { headers: { get(name: string): string | null } } | null | undefined,
  isWeChat: boolean,
): Promise<string[]> {
  const { getSystemConfig } = await import("@/lib/system-config");
  if (isWeChat) {
    const head = await getActiveAIProviderNameForRequest(request);
    return [head];
  }
  const dbChain = await getSystemConfig("AI_TEXT_PROVIDER_CHAIN");
  const envChain = process.env.AI_TEXT_PROVIDER_CHAIN ?? null;
  const explicit = parseChain<AIProviderName>(dbChain ?? envChain, ALL_AI_PROVIDERS);
  if (explicit.length > 0) return [...explicit];
  const legacyHead = await getActiveAIProviderName();
  const merged: AIProviderName[] = [legacyHead];
  for (const name of DEFAULT_WEB_TEXT_CHAIN) {
    if (!merged.includes(name)) merged.push(name);
  }
  return [...merged];
}

function extractRoutePath(
  request: { headers: { get(name: string): string | null } } | null | undefined,
): string | undefined {
  if (!request) return undefined;
  // NextRequest exposes `.nextUrl.pathname`; we keep this guard structural
  // so plain `Request` works too.
  const r = request as { nextUrl?: { pathname?: string }; url?: string };
  if (r.nextUrl?.pathname) return r.nextUrl.pathname;
  if (typeof r.url === "string") {
    try {
      return new URL(r.url).pathname;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Narrow a list of arbitrary keys to the known static union, dropping unknown. */
function narrowToKnown<T extends string>(
  resolved: string[],
  allowed: readonly T[],
  fallback: T,
): T[] {
  const out: T[] = [];
  for (const r of resolved) {
    const match = allowed.find((a) => a === r);
    if (match && !out.includes(match)) out.push(match);
  }
  return out.length > 0 ? out : [fallback];
}

/**
 * Parse a comma-separated provider chain ("qwen, gemini, openai") into a
 * deduped, validated list. Unknown tokens are silently dropped.
 */
function parseChain<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
): T[] {
  if (!raw) return [];
  const seen = new Set<T>();
  for (const token of raw.split(",")) {
    const value = token.trim().toLowerCase();
    if (!value) continue;
    const match = allowed.find((v) => v === value);
    if (match) seen.add(match);
  }
  return Array.from(seen);
}

/**
 * Image provider chain. Phase 3: resolves via `ProviderRoutingScope` rows
 * for the catch-all (web-default) image scope first; falls back to
 * SystemConfig `IMAGE_PROVIDER_CHAIN` → env → `IMAGE_FALLBACK_ORDER`.
 * Signature unchanged — no callers need updating.
 */
export async function getActiveImageProviderChain(
  request?: { headers: { get(name: string): string | null } } | null,
): Promise<AIProviderName[]> {
  const { isWeChatOriginatedRequest, getWeChatRegion } = await import(
    "@/lib/request-origin"
  );
  const { resolveChainForRequest } = await import("./routing");
  const isWeChat = isWeChatOriginatedRequest(request ?? null);
  const region = getWeChatRegion(request ?? null);
  const resolved = await resolveChainForRequest(
    "image",
    {
      isWeChat,
      region: region ?? undefined,
      routePath: extractRoutePath(request),
    },
    null,
    {
      fallback: async () => {
        const { getSystemConfig } = await import("@/lib/system-config");
        const dbValue = await getSystemConfig("IMAGE_PROVIDER_CHAIN");
        const envValue = process.env.IMAGE_PROVIDER_CHAIN ?? null;
        const fromConfig = parseChain<AIProviderName>(
          dbValue ?? envValue,
          ALL_AI_PROVIDERS,
        );
        if (fromConfig.length > 0) return [...fromConfig];
        return [...IMAGE_FALLBACK_ORDER];
      },
    },
  );
  return narrowToKnown(resolved, ALL_AI_PROVIDERS, "qwen");
}

/**
 * Voice provider chain. Phase 3: registry-first; admins can register new
 * TTS providers (e.g. `openai-tts`, `hunyuan-tts`) without code changes.
 * Returns `string[]` because voice keys are runtime-extensible.
 */
export async function getActiveVoiceProviderChain(
  request?: { headers: { get(name: string): string | null } } | null,
): Promise<VoiceProviderName[]> {
  const { isWeChatOriginatedRequest, getWeChatRegion } = await import(
    "@/lib/request-origin"
  );
  const { resolveChainForRequest } = await import("./routing");
  const isWeChat = isWeChatOriginatedRequest(request ?? null);
  const region = getWeChatRegion(request ?? null);
  const resolved = await resolveChainForRequest(
    "voice",
    {
      isWeChat,
      region: region ?? undefined,
      routePath: extractRoutePath(request),
    },
    null,
    {
      fallback: async () => {
        const { getSystemConfig } = await import("@/lib/system-config");
        const dbValue = await getSystemConfig("VOICE_PROVIDER_CHAIN");
        const envValue = process.env.VOICE_PROVIDER_CHAIN ?? null;
        if (dbValue || envValue) {
          const tokens = (dbValue ?? envValue ?? "")
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0);
          if (tokens.length > 0) return tokens;
        }
        return [...VOICE_FALLBACK_ORDER];
      },
    },
  );
  return resolved.length > 0 ? resolved : [...VOICE_FALLBACK_ORDER];
}

export function getProviderModelDefaults(provider: AIProviderName): {
  textModel: string | null;
  imageModel: string | null;
} {
  const meta = AI_PROVIDER_CATALOG[provider];
  return {
    textModel: meta.defaultTextModel ?? null,
    imageModel: meta.defaultImageModel ?? null,
  };
}

export async function getProviderModelState(provider: AIProviderName): Promise<{
  textModel: string | null;
  imageModel: string | null;
  textModelEnvKey: string | null;
  imageModelEnvKey: string | null;
}> {
  const meta = AI_PROVIDER_CATALOG[provider];
  const { getSystemConfig } = await import("@/lib/system-config");

  let dbTextModel: string | null = null;
  let dbImageModel: string | null = null;

  if (meta.textModelEnvKey) {
    dbTextModel = await getSystemConfig(meta.textModelEnvKey);
  }
  if (meta.imageModelEnvKey) {
    dbImageModel = await getSystemConfig(meta.imageModelEnvKey);
  }

  return {
    textModel: dbTextModel || getModelEnvValue(meta.textModelEnvKey) || meta.defaultTextModel || null,
    imageModel: dbImageModel || getModelEnvValue(meta.imageModelEnvKey) || meta.defaultImageModel || null,
    textModelEnvKey: meta.textModelEnvKey ?? null,
    imageModelEnvKey: meta.imageModelEnvKey ?? null,
  };
}

export function computeProviderHealth(keys: Set<string>) {
  return Object.fromEntries(
    ALL_AI_PROVIDERS.map((provider) => {
      const meta = AI_PROVIDER_CATALOG[provider];
      const configured = meta.requiredAny.some((group) =>
        group.every((key) => keys.has(key)),
      );
      return [
        provider,
        {
          configured,
          requiredAny: meta.requiredAny,
          optional: meta.optional,
          supportsImage: meta.supportsImage,
        },
      ];
    }),
  ) as Record<
    AIProviderName,
    ProviderRequirement & { configured: boolean; supportsImage: boolean }
  >;
}

/**
 * Same as `computeProviderHealth` but reads keys from the server's runtime
 * `process.env`. Used by the admin page when `VERCEL_MANAGEMENT_TOKEN` is
 * absent — Vercel injects the project env into runtime process.env, so this
 * is the source of truth for "what's actually wired up" without needing API
 * access.
 */
export function computeProviderHealthFromRuntime() {
  const present = new Set<string>();
  for (const value of Object.entries(process.env)) {
    const [key, val] = value;
    if (val && String(val).trim().length > 0) present.add(key);
  }
  return computeProviderHealth(present);
}


export function getOpenAITextModel(): string {
  return env.OPENAI_TEXT_MODEL?.trim() || OPENAI_DEFAULT_TEXT_MODEL;
}

export function getOpenAIImageModel(): string {
  return env.OPENAI_IMAGE_MODEL?.trim() || OPENAI_DEFAULT_IMAGE_MODEL;
}

export function getZAITextModel(): string {
  return env.ZAI_TEXT_MODEL?.trim() || ZAI_DEFAULT_TEXT_MODEL;
}

export function getZAIVertexTextModel(): string {
  return env.ZAI_TEXT_MODEL?.trim() || ZAI_DEFAULT_VERTEX_TEXT_MODEL;
}

export function getZAIImageModel(): string {
  return env.ZAI_IMAGE_MODEL?.trim() || ZAI_DEFAULT_IMAGE_MODEL;
}

export function getQwenTextModel(): string {
  return env.QWEN_TEXT_MODEL?.trim() || QWEN_DEFAULT_TEXT_MODEL;
}

export function getQwenImageModel(): string {
  return env.QWEN_IMAGE_MODEL?.trim() || QWEN_DEFAULT_IMAGE_MODEL;
}

export function getHunyuanTextModel(): string {
  return env.HUNYUAN_TEXT_MODEL?.trim() || HUNYUAN_DEFAULT_TEXT_MODEL;
}


export async function getGeminiTextModel(): Promise<string> {
  const state = await getProviderModelState("gemini");
  return state.textModel || GEMINI_DEFAULT_TEXT_MODEL;
}

export async function getGeminiImageModel(): Promise<string> {
  const state = await getProviderModelState("gemini");
  return state.imageModel || GEMINI_DEFAULT_IMAGE_MODEL;
}

export function getVolcengineTextModel(): string {
  return env.VOLCENGINE_MODEL_ID?.trim() || VOLCENGINE_DEFAULT_TEXT_MODEL;
}

export function getVolcengineImageModel(): string {
  return env.VOLCENGINE_IMAGE_MODEL?.trim() || VOLCENGINE_DEFAULT_IMAGE_MODEL;
}

export function getBytePlusTextModel(): string {
  return env.BYTEPLUS_MODEL_ID?.trim() || BYTEPLUS_DEFAULT_TEXT_MODEL;
}

export function getBytePlusImageModel(): string {
  return env.BYTEPLUS_IMAGE_MODEL?.trim() || BYTEPLUS_DEFAULT_IMAGE_MODEL;
}

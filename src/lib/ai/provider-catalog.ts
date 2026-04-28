import { env } from "@/lib/env";

export const ALL_AI_PROVIDERS = [
  "openai",
  "zai",
  "qwen",
  "gemini",
  "dedalus",
  "byteplus",
  "volcengine",
] as const;

export type AIProviderName = (typeof ALL_AI_PROVIDERS)[number];

export const IMAGE_FALLBACK_ORDER = [
  "openai",
  "zai",
  "qwen",
  "gemini",
  "dedalus",
] as const;

type ModelEnvKey =
  | "OPENAI_TEXT_MODEL"
  | "OPENAI_IMAGE_MODEL"
  | "ZAI_TEXT_MODEL"
  | "ZAI_IMAGE_MODEL"
  | "QWEN_TEXT_MODEL"
  | "QWEN_IMAGE_MODEL"
  | "GEMINI_TEXT_MODEL"
  | "GEMINI_IMAGE_MODEL"
  | "DEDALUS_MODEL"
  | "DEDALUS_IMAGE_MODEL"
  | "BYTEPLUS_MODEL_ID"
  | "VOLCENGINE_MODEL_ID";

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
export const DEDALUS_DEFAULT_TEXT_MODEL = "google/gemini-2.5-flash";
export const DEDALUS_DEFAULT_IMAGE_MODEL = "openai/dall-e-3";
export const BYTEPLUS_DEFAULT_TEXT_MODEL = "doubao-seed-1.6-flash";
export const VOLCENGINE_DEFAULT_TEXT_MODEL = "doubao-seed-1.6-flash";

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
    label: "Gemini",
    description: "Google Gemini text and image generation.",
    requiredAny: [["GEMINI_API_KEY"], ["GOOGLE_CLOUD_PROJECT", "GOOGLE_SERVICE_ACCOUNT_KEY"]],
    optional: ["GOOGLE_CLOUD_LOCATION", "GEMINI_IMAGE_VERTEX_LOCATION"],
    textModelEnvKey: "GEMINI_TEXT_MODEL",
    imageModelEnvKey: "GEMINI_IMAGE_MODEL",
    defaultTextModel: GEMINI_DEFAULT_TEXT_MODEL,
    defaultImageModel: GEMINI_DEFAULT_IMAGE_MODEL,
    supportsImage: true,
  },
  dedalus: {
    label: "Dedalus",
    description: "Brokered provider. Defaults stay conservative unless explicitly overridden.",
    requiredAny: [["DEDALUS_API_KEY"]],
    optional: ["DEDALUS_MATCH_MODEL"],
    textModelEnvKey: "DEDALUS_MODEL",
    imageModelEnvKey: "DEDALUS_IMAGE_MODEL",
    defaultTextModel: DEDALUS_DEFAULT_TEXT_MODEL,
    defaultImageModel: DEDALUS_DEFAULT_IMAGE_MODEL,
    supportsImage: true,
  },
  byteplus: {
    label: "BytePlus / ModelArk",
    description: "Text-only OpenAI-compatible provider for BytePlus deployments.",
    requiredAny: [["BYTEPLUS_API_KEY"]],
    optional: [],
    textModelEnvKey: "BYTEPLUS_MODEL_ID",
    defaultTextModel: BYTEPLUS_DEFAULT_TEXT_MODEL,
    supportsImage: false,
  },
  volcengine: {
    label: "Volcengine / Doubao",
    description: "Text-only OpenAI-compatible provider for mainland deployments.",
    requiredAny: [["VOLCENGINE_API_KEY"]],
    optional: [],
    textModelEnvKey: "VOLCENGINE_MODEL_ID",
    defaultTextModel: VOLCENGINE_DEFAULT_TEXT_MODEL,
    supportsImage: false,
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
    case "DEDALUS_MODEL":
      return env.DEDALUS_MODEL?.trim();
    case "DEDALUS_IMAGE_MODEL":
      return env.DEDALUS_IMAGE_MODEL?.trim();
    case "BYTEPLUS_MODEL_ID":
      return env.BYTEPLUS_MODEL_ID?.trim();
    case "VOLCENGINE_MODEL_ID":
      return env.VOLCENGINE_MODEL_ID?.trim();
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
 *   `WECHAT_AI_PROVIDER` SystemConfig / env, falling back to `qwen` so CN
 *   clients hit a CN-region inference endpoint instead of crossing the GFW.
 * - All other traffic uses the default `getActiveAIProviderName()`.
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
    dbProvider || env.WECHAT_AI_PROVIDER || "qwen",
  );
  return resolved ?? "qwen";
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


export async function getGeminiTextModel(): Promise<string> {
  const state = await getProviderModelState("gemini");
  return state.textModel || GEMINI_DEFAULT_TEXT_MODEL;
}

export async function getGeminiImageModel(): Promise<string> {
  const state = await getProviderModelState("gemini");
  return state.imageModel || GEMINI_DEFAULT_IMAGE_MODEL;
}

export async function getDedalusTextModel(): Promise<string> {
  const state = await getProviderModelState("dedalus");
  return state.textModel || DEDALUS_DEFAULT_TEXT_MODEL;
}

export async function getDedalusImageModel(): Promise<string> {
  const state = await getProviderModelState("dedalus");
  return state.imageModel || DEDALUS_DEFAULT_IMAGE_MODEL;
}

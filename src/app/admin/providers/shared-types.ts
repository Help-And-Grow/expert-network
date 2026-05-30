/**
 * Shared types for the /admin/providers page and its tab components.
 * Extracted from providers-client.tsx during admin cleanup (2026-05-30).
 */

export type ProviderRow = {
  id: string;
  category: string;
  key: string;
  displayName: string;
  enabled: boolean;
  envKeys: Record<string, string>;
  models: Record<
    string,
    { envKey?: string; default?: string | null } | undefined
  >;
  metadata: Record<string, unknown> | null;
  sortOrder: number;
};

export type ProviderHealthEntry = {
  configured: boolean;
  requiredAny: string[][];
  optional: string[];
  supportsImage: boolean;
};

export type RoutingMatchRules = {
  isWeChat?: boolean;
  region?: "intl" | "cn";
  userAgent?: string;
  header?: Record<string, string>;
};

export type RoutingScopeRow = {
  id: string;
  scopeKey: string;
  displayName: string;
  description: string | null;
  category: "llm" | "image" | "voice" | "storage";
  chain: string[];
  enabled: boolean;
  matchRules: RoutingMatchRules;
  priority: number;
  environment: string;
};

export type RouteOverrideRow = {
  id: string;
  routePattern: string;
  category: "llm" | "image" | "voice" | "storage";
  chainOverride: string[];
  enabled: boolean;
  reason: string | null;
  environment: string;
};

export type CloudRegionSetting = {
  key: string;
  label: string;
  group: "gcp" | "tencent" | "database";
  fallbackDefault: string;
  readonly?: boolean;
  description?: string;
  effective: string;
  dbValue: string | null;
  envValue: string | null;
  source: "db" | "env" | "default";
};

export type Environment = "production" | "preview" | "development";

export type ApiState = {
  llm: ProviderRow[];
  storage: ProviderRow[];
  cloudRegions?: CloudRegionSetting[];
  driftCount?: number;
  db: { provider: string; host: string | null };
  active: {
    llm: string;
    storage: string;
    llmImageChain: string[];
    llmVoiceChain: string[];
  };
  routing: {
    scopes: {
      llm: RoutingScopeRow[];
      image: RoutingScopeRow[];
      voice: RoutingScopeRow[];
      storage: RoutingScopeRow[];
    };
    overrides: {
      llm: RouteOverrideRow[];
      image: RouteOverrideRow[];
      voice: RouteOverrideRow[];
      storage: RouteOverrideRow[];
    };
  };
  defaults: {
    llmImageChain: string[];
    llmVoiceChain: string[];
    voiceOptions: string[];
  };
  providerHealth: Record<string, ProviderHealthEntry>;
  canManage: boolean;
  deployHookConfigured: boolean;
  environment: Environment;
  currentVercelEnv: Environment | null;
};

export type DraftState = {
  activeLlm: string;
  llmImageChain: string[];
  llmVoiceChain: string[];
  activeStorage: string;
  models: Record<string, { textModel?: string; imageModel?: string }>;
  /** Edited copies of routing scopes, keyed by `${category}:${scopeKey}`. */
  scopes: Record<
    string,
    { chain: string[]; enabled: boolean; priority: number }
  >;
  /** Edited copies of route overrides, keyed by `${category}:${routePattern}`. */
  overrides: Record<
    string,
    {
      chainOverride: string[];
      enabled: boolean;
      reason: string | null;
      isNew?: boolean;
      category: "llm" | "image" | "voice" | "storage";
      routePattern: string;
    }
  >;
  deletedOverrides: Array<{
    routePattern: string;
    category: "llm" | "image" | "voice" | "storage";
  }>;
  /** Edited cloud-region SystemConfig values, keyed by config key. */
  cloudRegions: Record<string, string>;
};

export type ChainPickerOption = { value: string; label: string };

export type AuditRow = {
  id: string;
  changedAt: string;
  actorEmail: string | null;
  actorRole: string | null;
  category: string;
  configKey: string;
  environment: string;
  before: unknown;
  after: unknown;
  reason: string | null;
};

export type DiffEntry = { label: string; before: string; after: string };

export type ProbeState =
  | { status: "idle" }
  | { status: "pending" }
  | {
      status: "done";
      ok: boolean;
      latencyMs: number;
      sampleOutput?: string;
      error?: string;
      cached?: boolean;
    };

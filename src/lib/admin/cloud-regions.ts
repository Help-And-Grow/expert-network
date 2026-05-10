import { getSystemConfig, type Environment } from "@/lib/system-config";

/**
 * Phase 4: Cloud-region settings tab on /admin/providers.
 *
 * The values below are surfaced as editable SystemConfig rows so an
 * operator can rotate GCP/Tencent regions or buckets from the admin UI
 * without redeploying. Resolution order at runtime is:
 *
 *   SystemConfig (DB)  →  process.env  →  fallbackDefault
 *
 * Read-only entries are surfaced for auditing only — they're set in
 * infra (Cloud SQL instance label/region) and changing them here does
 * NOT move the database; the cutover runbook is the source of truth.
 */
export type CloudRegionGroup = "gcp" | "tencent" | "database";

export type CloudRegionSetting = {
  key: string;
  label: string;
  group: CloudRegionGroup;
  /** Hard-coded fallback if neither DB nor env is set. */
  fallbackDefault: string;
  /** Read-only display — do not allow editing in the admin UI. */
  readonly?: boolean;
  description?: string;
};

export const CLOUD_REGION_SETTINGS: readonly CloudRegionSetting[] = [
  {
    key: "GOOGLE_CLOUD_PROJECT",
    label: "GCP project",
    group: "gcp",
    fallbackDefault: "",
    description:
      "Used by Vertex AI (Gemini, ZAI) and Google Cloud Storage. Required for any Vertex-backed provider.",
  },
  {
    key: "GOOGLE_CLOUD_LOCATION",
    label: "GCP location",
    group: "gcp",
    fallbackDefault: "asia-southeast1",
    description: "Default Vertex region (Singapore).",
  },
  {
    key: "GEMINI_IMAGE_VERTEX_LOCATION",
    label: "Gemini image Vertex location",
    group: "gcp",
    fallbackDefault: "",
    description:
      "Override region for Gemini image generation (Imagen). Falls back to GOOGLE_CLOUD_LOCATION when empty.",
  },
  {
    key: "ZAI_VERTEX_LOCATION",
    label: "ZAI Vertex location",
    group: "gcp",
    fallbackDefault: "",
    description:
      "Override region for ZAI on Vertex. Falls back to GOOGLE_CLOUD_LOCATION when empty.",
  },
  {
    key: "GCS_BUCKET_NAME",
    label: "GCS bucket name",
    group: "gcp",
    fallbackDefault: "",
    description: "Bucket used by the GCS storage adapter.",
  },
  {
    key: "TENCENT_COS_REGION",
    label: "Tencent COS region",
    group: "tencent",
    fallbackDefault: "",
    description:
      "COS region (e.g. ap-guangzhou). Used by the Tencent storage adapter and WeChat-CN traffic.",
  },
  {
    key: "TENCENT_COS_BUCKET",
    label: "Tencent COS bucket",
    group: "tencent",
    fallbackDefault: "",
    description: "Bucket name used by the Tencent COS adapter.",
  },
  {
    key: "CLOUDSQL_INSTANCE",
    label: "Cloud SQL instance",
    group: "database",
    fallbackDefault: "hg-postgres-prod",
    readonly: true,
    description:
      "Display only. Database cutover requires manual coordination — see docs/RUNBOOK.md.",
  },
  {
    key: "CLOUDSQL_REGION",
    label: "Cloud SQL region",
    group: "database",
    fallbackDefault: "asia-southeast1",
    readonly: true,
    description: "Display only. See docs/RUNBOOK.md.",
  },
];

export type ResolvedCloudRegionSetting = CloudRegionSetting & {
  /** Effective value (DB → env → default). */
  effective: string;
  /** The DB-stored override, if any. */
  dbValue: string | null;
  /** The current process env value at request time, if any. */
  envValue: string | null;
  /** Where `effective` came from. */
  source: "db" | "env" | "default";
};

/**
 * Resolve every cloud-region setting for the given environment. Each entry
 * exposes the DB value, env value and an `effective` value so the admin UI
 * can show drift inline.
 *
 * Note: `process.env` here is the env of the *server process serving the
 * admin page* (production runtime). The admin UI also surfaces this value
 * in the "current env" hint so operators can see drift between an edit in
 * the DB and the not-yet-deployed Vercel env.
 */
export async function getCloudRegionSettings(
  environment: Environment,
): Promise<ResolvedCloudRegionSetting[]> {
  return Promise.all(
    CLOUD_REGION_SETTINGS.map(async (s) => {
      const dbValue = await getSystemConfig(s.key, environment);
      const envValue = process.env[s.key] ?? null;
      let effective: string;
      let source: "db" | "env" | "default";
      if (dbValue !== null && dbValue !== "") {
        effective = dbValue;
        source = "db";
      } else if (envValue !== null && envValue !== "") {
        effective = envValue;
        source = "env";
      } else {
        effective = s.fallbackDefault;
        source = "default";
      }
      return {
        ...s,
        dbValue,
        envValue,
        effective,
        source,
      };
    }),
  );
}

/**
 * Allow-list of SystemConfig keys that the drift detector compares against
 * Vercel project env. Anything not in this list is intentionally DB-only
 * (e.g. feature flags / experiments that we don't want to mirror to Vercel
 * because they should be reversible without a redeploy).
 *
 * Keep this in sync with the keys actually written via
 * `POST /api/admin/providers` (the unified apply endpoint).
 */
export const DRIFT_MANAGED_KEYS: readonly string[] = [
  // Active provider selectors (Phase 1-3).
  "AI_PROVIDER",
  "AI_TEXT_PROVIDER_CHAIN",
  "IMAGE_PROVIDER_CHAIN",
  "VOICE_PROVIDER_CHAIN",
  "STORAGE_PROVIDER",
  // Cloud region knobs (Phase 4).
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GEMINI_IMAGE_VERTEX_LOCATION",
  "ZAI_VERTEX_LOCATION",
  "GCS_BUCKET_NAME",
  "TENCENT_COS_REGION",
  "TENCENT_COS_BUCKET",
];

/** Keys that should never appear in an export unless explicitly requested. */
export const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /_API_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /^STRIPE_.*_KEY$/i,
  /MNEMONIC/i,
  /PRIVATE_KEY/i,
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

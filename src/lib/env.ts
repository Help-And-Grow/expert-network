import { z } from "zod";

/**
 * Vercel and dashboards often store "unset" optional vars as "".
 * Zod treats "" as present, so e.g. z.string().url().optional() still fails on "".
 */
function sanitizedProcessEnv(): Record<string, string | undefined> {
  const raw = process.env as Record<string, string | undefined>;
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(raw)) {
    const v = raw[key];
    if (v === undefined) continue;
    // Vercel / .env files sometimes include trailing newlines (e.g. `async\n`).
    let trimmed = v.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      trimmed = trimmed.slice(1, -1).trim();
    }
    out[key] = trimmed === "" ? undefined : trimmed;
  }
  return out;
}

/**
 * Prisma and DB helpers read `process.env` directly; this returns DATABASE_URL
 * after the same trimming + outer-quote stripping that the schema validator
 * applies, so a value that's empty after trim becomes `undefined`.
 *
 * The Vercel Marketplace Supabase alias path was removed when production cut
 * over to Cloud SQL on 2026-05-03. See
 * docs/exec-plans/active/supabase-to-cloudsql-migration.md.
 */
export function resolvePrimaryDatabaseUrl(): string | undefined {
  return sanitizedProcessEnv().DATABASE_URL;
}

function postgresConnectionUrl(message: string) {
  return z
    .string({ required_error: message })
    .min(1, message)
    .refine(
      (s) => {
        try {
          const u = new URL(s);
          return u.protocol === "postgresql:" || u.protocol === "postgres:";
        } catch {
          return false;
        }
      },
      { message: "DATABASE_URL must be a postgresql:// or postgres:// URL" },
    );
}

function httpOriginUrl(message: string) {
  return z
    .string({ required_error: message })
    .min(1, message)
    .refine(
      (s) => {
        try {
          const u = new URL(s);
          return u.protocol === "https:" || u.protocol === "http:";
        } catch {
          return false;
        }
      },
      { message: "NEXTAUTH_URL must be a valid http(s) URL (e.g. https://your-domain.vercel.app)" },
    );
}

const envSchema = z
  .object({
    DATABASE_URL: postgresConnectionUrl("DATABASE_URL is required"),
    NEXTAUTH_URL: httpOriginUrl("NEXTAUTH_URL is required"),
    NEXTAUTH_SECRET: z.string().optional(),
    AUTH_SECRET: z.string().optional(),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    /** Places API (New) server key for address autocomplete (bookings / meetup location). Enable "Places API (New)" in Google Cloud. */
    GOOGLE_PLACES_API_KEY: z.string().optional(),
    /** Comma-separated ISO country codes to bias autocomplete (default: sg). */
    GOOGLE_PLACES_REGION_CODES: z.string().optional(),

    EMAIL_SERVER_HOST: z.string().optional(),
    EMAIL_SERVER_PORT: z.string().optional(),
    EMAIL_SERVER_USER: z.string().optional(),
    EMAIL_SERVER_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    /** Resend-only "from" for booking emails (`src/lib/email.ts`). Optional; defaults in code. */
    RESEND_EMAIL_FROM: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),

    /**
     * Head of the text-provider chain for non-WeChat surfaces (Web, Telegram,
     * REST). Default `qwen`. The full chain is Qwen → Gemini; this var only
     * controls the head, so existing Vercel deploys with `AI_PROVIDER=gemini`
     * continue to work (Gemini becomes the head, Qwen is appended as fallback).
     * For full chain control set the SystemConfig key `AI_TEXT_PROVIDER_CHAIN`.
     */
    AI_PROVIDER: z
      .enum(["gemini", "qwen", "hunyuan", "openai", "zai", "byteplus", "volcengine"])
      .default("qwen"),
    /**
     * Provider used when the request originates from the WeChat Mini Program
     * (detected via TCB-stamped headers in `lib/request-origin.ts`). Defaults
     * to `hunyuan` so both WeChat-CN and WeChat-Intl stacks run entirely on
     * Tencent Cloud — no cross-cloud fallback for WeChat by design.
     */
    WECHAT_AI_PROVIDER: z
      .enum(["gemini", "qwen", "hunyuan", "openai", "zai", "byteplus", "volcengine"])
      .optional(),
    /** Tencent Cloud Hunyuan API key — sub-account key from CAM with Hunyuan permissions. */
    HUNYUAN_API_KEY: z.string().optional(),
    /** Hunyuan model id (default: hunyuan-turbo). hunyuan-pro / hunyuan-standard / hunyuan-lite also valid. */
    HUNYUAN_TEXT_MODEL: z.string().optional(),

    STORAGE_PROVIDER: z
      .enum(["vercel", "gcs", "tencent-cos", "db"])
      .default("db"),

    GEMINI_API_KEY: z.string().optional(),
    GOOGLE_CLOUD_PROJECT: z.string().optional(),
    GOOGLE_CLOUD_LOCATION: z.string().optional(),
    GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
    BYTEPLUS_API_KEY: z.string().optional(),
    BYTEPLUS_MODEL_ID: z.string().optional(),
    VOLCENGINE_API_KEY: z.string().optional(),
    VOLCENGINE_MODEL_ID: z.string().optional(),

    GEMINI_TEXT_MODEL: z.string().optional(),
    GEMINI_IMAGE_MODEL: z.string().optional(),
    /** Gemini native TTS model (Vertex / AI Studio). */
    GEMINI_TTS_MODEL: z.string().optional(),
    GEMINI_TTS_VOICE_MALE: z.string().optional(),
    GEMINI_TTS_VOICE_FEMALE: z.string().optional(),
    /** Gemini text embedding model used by pgvector memory (default `gemini-embedding-001`). */
    GEMINI_EMBEDDING_MODEL: z.string().optional(),
    /** Vertex AI region for image generation only. `gemini-3.1-flash-image-preview` is not in every region; default `global` when unset. */
    GEMINI_IMAGE_VERTEX_LOCATION: z.string().optional(),

    DASHSCOPE_API_KEY: z.string().optional(),
    QWEN_TEXT_MODEL: z.string().optional(),
    QWEN_IMAGE_MODEL: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_TEXT_MODEL: z.string().optional(),
    OPENAI_IMAGE_MODEL: z.string().optional(),
    ZAI_API_KEY: z.string().optional(),
    ZAI_BASE_URL: z.string().url().optional(),
    ZAI_TEXT_MODEL: z.string().optional(),
    ZAI_IMAGE_MODEL: z.string().optional(),
    ZAI_VERTEX_LOCATION: z.string().optional(),

    TELEGRAM_BOT_TOKEN: z.string().optional(),

    BASE_RPC_URL: z.string().url().optional(),
    POMP_ISSUER_PRIVATE_KEY: z.string().optional(),
    POMP_EAS_SCHEMA_UID: z.string().optional(),
    EAS_CONTRACT_ADDRESS: z.string().optional(),

    HG_TOKEN_CONTRACT_ADDRESS: z.string().optional(),

    ALCHEMY_WEBHOOK_SECRET: z.string().optional(),

    HICLAW_POSTGRES_URL: z.string().url().optional(),

    /** Enable hosted mem9 expert memory. Set "1" for per-expert key provisioning. */
    MEM9_ENABLED: z.string().optional(),
    /** Compatibility toggle for older deployments; runtime calls use per-expert keys in Expert.mem9SpaceId. */
    MEM9_API_KEY: z.string().optional(),
    /** Backward-compatible alias used as a compatibility toggle; not a production shared-space default. */
    MEM9_SPACE_ID: z.string().optional(),
    /** Hosted mem9 API origin. Defaults to https://api.mem9.ai. */
    MEM9_API_BASE: z.string().url().optional(),
    /** Agent attribution sent as X-Mnemo-Agent-Id to hosted mem9. */
    MEM9_AGENT_ID: z.string().optional(),

    WECHAT_PAY_MCH_ID: z.string().optional(),
    WECHAT_PAY_API_V3_KEY: z.string().optional(),
    WECHAT_PAY_CERT_SERIAL_NO: z.string().optional(),
    WECHAT_PAY_PRIVATE_KEY: z.string().optional(),
    WECHAT_APP_ID: z.string().optional(),
    WECHAT_PAY_NOTIFY_URL: z.string().optional(),
    /** Service-provider mode: use partner JSAPI + profit sharing (set "true") */
    WECHAT_PAY_PARTNER_MODE: z.enum(["true", "false"]).optional(),
    /** Sub-merchant receiving the payment (Expert.wechatSubMchId per expert) */
    WECHAT_PAY_PLATFORM_MCH_ID: z.string().optional(),
    /** Legal name of platform merchant for profit-sharing `name` (encrypted) */
    WECHAT_PAY_PLATFORM_MERCHANT_NAME: z.string().optional(),
    /** PEM of WeChat Pay platform public key (for OAEP encrypting receiver name) */
    WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM: z.string().optional(),
    /** Wechatpay-Serial header: platform certificate serial or public key id */
    WECHAT_PAY_PLATFORM_CERT_SERIAL: z.string().optional(),

    /** Tencent RTC SDKAppID from the TRTC console. */
    TRTC_APP_ID: z.coerce.number().int().positive().optional(),
    /** Tencent RTC SDKSecretKey. Prefer this name in new deployments. */
    TRTC_SECRET_KEY: z.string().min(1).optional(),
    /** Backward-compatible alias for older docs/scripts. */
    TRTC_APP_SECRET: z.string().min(1).optional(),
    /** Booking-scoped H&G token debit for premium live access. */
    TRTC_PREMIUM_LIVE_TOKENS: z.coerce.number().int().min(0).optional(),
    /** How early before the booking start a participant may request TRTC credentials. */
    TRTC_PREJOIN_SECONDS: z.coerce.number().int().min(0).optional(),
    /** How long after the booking end room entry remains valid for reconnects/grace. */
    TRTC_POST_END_GRACE_SECONDS: z.coerce.number().int().min(0).optional(),
    /** TRTC server callback shared secret (回调密钥). Letters + digits, ≤32 chars. */
    TRTC_CALLBACK_KEY: z.string().min(1).max(32).optional(),

    VOICE_CHAT_MODE: z.enum(["async", "realtime", "both"]).default("async"),
    /** Override default Qwen built-in voice (e.g. Cherry) when expert has no voice clone. */
    VOICE_CHAT_DEFAULT_VOICE: z.string().min(1).optional(),
    /** Local dev only: enables one-click "Dev login" on /auth/signin (`next dev` only). */
    DEV_AUTH_EMAIL: z.string().min(1).optional(),
    /** Local dev only: role for the auto-provisioned dev-login user. */
    DEV_AUTH_ROLE: z.enum(["USER", "ADMIN"]).optional(),
    /** Enable admin-gated `/api/debug/*` reads in production. Keep unset by default. */
    DEBUG_API_ENABLED: z.enum(["1"]).optional(),
    /** Enable destructive admin-gated debug mutations such as clean/delete/db-push. */
    DEBUG_MUTATION_ENABLED: z.enum(["1"]).optional(),
    /** Hidden credentials-based sign-in for production-safe browser E2E. */
    E2E_AUTH_EMAIL: z.string().email().optional(),
    E2E_AUTH_ROLE: z.enum(["USER", "ADMIN"]).optional(),
    E2E_AUTH_TOKEN: z.string().min(24).optional(),

    VERCEL_MANAGEMENT_TOKEN: z.string().optional(),
    VERCEL_MANAGED_TEAM_ID: z.string().optional(),
    VERCEL_MANAGED_PROJECT: z.string().optional(),
    VERCEL_DEPLOY_HOOK_URL: z.string().url().optional(),

    /** Vercel Blob storage token. */
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
    /** GCS Bucket name. */
    GCS_BUCKET_NAME: z.string().optional(),
    /** Tencent COS credentials (cam.tencentcloud.com → API keys). */
    TENCENT_COS_SECRET_ID: z.string().optional(),
    TENCENT_COS_SECRET_KEY: z.string().optional(),
    /** Bucket name including AppID suffix, e.g. "hg-wechat-1300000000". */
    TENCENT_COS_BUCKET: z.string().optional(),
    /** COS region, e.g. "ap-guangzhou" / "ap-singapore". */
    TENCENT_COS_REGION: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (process.env.NODE_ENV !== "production") return;
    const secret = data.AUTH_SECRET ?? data.NEXTAUTH_SECRET;
    if (!secret || secret.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SECRET"],
        message:
          "Set AUTH_SECRET or NEXTAUTH_SECRET to a random string of at least 32 characters (e.g. openssl rand -base64 32)",
      });
    }
  });

let _env: z.infer<typeof envSchema>;

function shouldSkipEnvValidation(): boolean {
  if (process.env.SKIP_ENV_VALIDATION === "1") return true;
  if (process.env.npm_lifecycle_event === "build") return true;
  // `next build` (and some worker processes) do not always inherit `npm_lifecycle_event`
  // when invoked as `npx next build` or from tooling. Use bracket access so the phase is
  // read at runtime rather than inlined (see vercel/next.js discussions/48736).
  const nextPhase = process.env["NEXT_PHASE"];
  return nextPhase === "phase-production-build" || nextPhase === "phase-export";
}

if (shouldSkipEnvValidation()) {
  _env = sanitizedProcessEnv() as unknown as z.infer<typeof envSchema>;
} else {
  const result = envSchema.safeParse(sanitizedProcessEnv());
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const detail = JSON.stringify(fieldErrors);
    console.error("⚠️ Invalid environment variables:", fieldErrors);
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Invalid environment variables: ${detail}`);
    }
    _env = sanitizedProcessEnv() as unknown as z.infer<typeof envSchema>;
  } else {
    _env = result.data;
  }
}

export const env = _env;

export function assertProductionEnv(): void {
  // Validation is executed at module load time.
}

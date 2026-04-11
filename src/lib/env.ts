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
    const trimmed = v.trim();
    out[key] = trimmed === "" ? undefined : trimmed;
  }
  return out;
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

    EMAIL_SERVER_HOST: z.string().optional(),
    EMAIL_SERVER_PORT: z.string().optional(),
    EMAIL_SERVER_USER: z.string().optional(),
    EMAIL_SERVER_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    /** Resend-only "from" for booking emails (`src/lib/email.ts`). Optional; defaults in code. */
    RESEND_EMAIL_FROM: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),

    AI_PROVIDER: z
      .enum(["dedalus", "gemini", "qwen", "openai", "zai", "byteplus", "volcengine"])
      .default("qwen"),

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

    DASHSCOPE_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    ZAI_API_KEY: z.string().optional(),
    ZAI_BASE_URL: z.string().url().optional(),
    ZAI_TEXT_MODEL: z.string().optional(),
    ZAI_IMAGE_MODEL: z.string().optional(),
    ZAI_VERTEX_LOCATION: z.string().optional(),

    DEDALUS_API_KEY: z.string().optional(),
    DEDALUS_MODEL: z.string().optional(),
    DEDALUS_MATCH_MODEL: z.string().optional(),

    TELEGRAM_BOT_TOKEN: z.string().optional(),

    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),

    BASE_RPC_URL: z.string().url().optional(),
    POMP_ISSUER_PRIVATE_KEY: z.string().optional(),
    POMP_EAS_SCHEMA_UID: z.string().optional(),
    EAS_CONTRACT_ADDRESS: z.string().optional(),

    HG_TOKEN_CONTRACT_ADDRESS: z.string().optional(),

    ALCHEMY_WEBHOOK_SECRET: z.string().optional(),

    HICLAW_POSTGRES_URL: z.string().url().optional(),

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

    FISH_AUDIO_API_KEY: z.string().optional(),
    FISH_AUDIO_VOICE_ID_MALE: z.string().optional(),
    FISH_AUDIO_VOICE_ID_FEMALE: z.string().optional(),

    VOICE_CHAT_MODE: z.enum(["async", "realtime", "both"]).default("async"),
    REALTIME_BACKEND: z.enum(["ten", "agora"]).default("ten"),
    /** Override default Qwen built-in voice (e.g. Cherry) when expert has no voice clone. */
    VOICE_CHAT_DEFAULT_VOICE: z.string().min(1).optional(),
    /** Local dev only: enables one-click "Dev login" on /auth/signin (`next dev` only). */
    DEV_AUTH_EMAIL: z.string().min(1).optional(),
    /** Local dev only: role for the auto-provisioned dev-login user. */
    DEV_AUTH_ROLE: z.enum(["EXPERT", "FOUNDER", "ADMIN"]).optional(),
    /** Hidden credentials-based sign-in for production-safe browser E2E. */
    E2E_AUTH_EMAIL: z.string().email().optional(),
    E2E_AUTH_ROLE: z.enum(["EXPERT", "FOUNDER", "ADMIN"]).optional(),
    E2E_AUTH_TOKEN: z.string().min(24).optional(),
    AGORA_APP_ID: z.string().optional(),
    AGORA_APP_CERTIFICATE: z.string().optional(),
    TEN_AGENT_URL: z.string().url().optional(),

    VERCEL_MANAGEMENT_TOKEN: z.string().optional(),
    VERCEL_MANAGED_TEAM_ID: z.string().optional(),
    VERCEL_MANAGED_PROJECT: z.string().optional(),
    VERCEL_DEPLOY_HOOK_URL: z.string().url().optional(),
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

if (process.env.SKIP_ENV_VALIDATION === "1" || process.env.npm_lifecycle_event === "build") {
  _env = process.env as unknown as z.infer<typeof envSchema>;
} else {
  const result = envSchema.safeParse(sanitizedProcessEnv());
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const detail = JSON.stringify(fieldErrors);
    console.error("⚠️ Invalid environment variables:", fieldErrors);
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Invalid environment variables: ${detail}`);
    }
    _env = process.env as unknown as z.infer<typeof envSchema>;
  } else {
    _env = result.data;
  }
}

export const env = _env;

export function assertProductionEnv(): void {
  // Validation is executed at module load time.
}

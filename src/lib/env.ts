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
    out[key] = v === "" ? undefined : v;
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

    AI_PROVIDER: z
      .enum(["dedalus", "gemini", "qwen", "openai"])
      .default("gemini"),

    GEMINI_API_KEY: z.string().optional(),
    GOOGLE_CLOUD_PROJECT: z.string().optional(),
    GOOGLE_CLOUD_LOCATION: z.string().optional(),

    DASHSCOPE_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),

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

    TIDB_DATABASE_URL: z.string().url().optional(),
    HICLAW_POSTGRES_URL: z.string().url().optional(),
    DB9_DATABASE_URL: z.string().url().optional(),

    WECHAT_PAY_MCH_ID: z.string().optional(),
    WECHAT_PAY_API_V3_KEY: z.string().optional(),
    WECHAT_PAY_CERT_SERIAL_NO: z.string().optional(),
    WECHAT_PAY_PRIVATE_KEY: z.string().optional(),
    WECHAT_APP_ID: z.string().optional(),
    WECHAT_PAY_NOTIFY_URL: z.string().optional(),

    FISH_AUDIO_API_KEY: z.string().optional(),
    FISH_AUDIO_VOICE_ID_MALE: z.string().optional(),
    FISH_AUDIO_VOICE_ID_FEMALE: z.string().optional(),
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

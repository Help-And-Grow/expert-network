import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  EMAIL_SERVER_HOST: z.string().optional(),
  EMAIL_SERVER_PORT: z.string().optional(),
  EMAIL_SERVER_USER: z.string().optional(),
  EMAIL_SERVER_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  AI_PROVIDER: z.enum(["gemini", "qwen", "openai"]).default("gemini"),
  
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

  WECHAT_PAY_MCH_ID: z.string().optional(),
  WECHAT_PAY_API_V3_KEY: z.string().optional(),
  WECHAT_PAY_CERT_SERIAL_NO: z.string().optional(),
  WECHAT_PAY_PRIVATE_KEY: z.string().optional(),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_PAY_NOTIFY_URL: z.string().optional(),

  FISH_AUDIO_API_KEY: z.string().optional(),
  FISH_AUDIO_VOICE_ID_MALE: z.string().optional(),
  FISH_AUDIO_VOICE_ID_FEMALE: z.string().optional(),
});

const _env = process.env.SKIP_ENV_VALIDATION 
  ? (process.env as unknown as z.infer<typeof envSchema>)
  : envSchema.parse(process.env);

export const env = _env;

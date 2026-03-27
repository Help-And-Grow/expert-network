/**
 * Production environment validation — fail fast with readable errors.
 *
 * For local/dev, we do not block: Prisma may use a mock URL when DATABASE_URL
 * is unset (see prisma.ts). Vercel production must set real values.
 *
 * Bypass (emergency only): SKIP_ENV_VALIDATION=1
 */

import { z } from "zod";

const productionSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (u) => !u.includes("mock:mock@localhost"),
      "DATABASE_URL must be a real connection string in production",
    ),
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL"),
  NEXTAUTH_SECRET: z
    .string()
    .min(32, "NEXTAUTH_SECRET must be at least 32 characters"),
});

/**
 * Call once when the server process loads (e.g. before Prisma client).
 * No-op in development/test unless you set NODE_ENV=production locally.
 */
export function assertProductionEnv(): void {
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const result = productionSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  });

  if (!result.success) {
    const flat = result.error.flatten().fieldErrors;
    const lines = Object.entries(flat)
      .map(([k, v]) => `  ${k}: ${(v ?? []).join("; ")}`)
      .join("\n");
    throw new Error(
      `[env] Production configuration is invalid or incomplete.\n${lines}\n\nSee .env.example and your Vercel Environment Variables.`,
    );
  }
}

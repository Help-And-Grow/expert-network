import { Pool, type PoolConfig } from "pg";

/**
 * Default pool limits tuned for serverless (Vercel Functions).
 * db-g1-small has a 50-connection ceiling. Each function invocation gets its
 * own pool, so we cap at 2 connections per function to avoid fan-out spikes.
 *
 * Rule of thumb: `POOL_MAX_PER_FUNC × maxConcurrentFunctions < ceiling`.
 * At pool max=2, we support ~25 concurrent functions before hitting 50.
 */
const POOL_MAX = Number(process.env.POSTGRES_POOL_MAX) || 2;
const POOL_IDLE_TIMEOUT = 10_000;  // close idle connections after 10s (serverless)

const basePoolOptions: Omit<PoolConfig, "connectionString" | "ssl"> = {
  max: POOL_MAX,
  idleTimeoutMillis: POOL_IDLE_TIMEOUT,
  connectionTimeoutMillis: 5_000,
};

/**
 * `pg` will only auto-enable TLS when `connectionString` carries `?ssl=true`
 * or matching options. For managed providers (Cloud SQL, Neon, etc.) the URL
 * carries `sslmode=require` instead, which `pg` ignores at parse time. Strip
 * the param and pass `ssl: { rejectUnauthorized: false }` explicitly — that
 * matches what Prisma does and accepts the provider's self-signed/CA cert.
 *
 * Also strips the Prisma-only `sslaccept` param if present (Prisma's Rust
 * engine reads it; node-postgres doesn't, but leaving an unknown param in
 * the URL is harmless — we strip it to keep the URL we hand to pg minimal).
 */
export function createPostgresPool(
  connectionString: string,
  options: Omit<PoolConfig, "connectionString" | "ssl"> = {},
): Pool {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();

    if (sslMode === "require" || sslMode === "prefer" || sslMode === "verify-ca" || sslMode === "verify-full") {
      url.searchParams.delete("sslmode");
      url.searchParams.delete("sslaccept");
      url.searchParams.delete("uselibpqcompat");
      return new Pool({
        ...basePoolOptions,
        ...options,
        connectionString: url.toString(),
        ssl: { rejectUnauthorized: false },
      });
    }
  } catch {
    // Fall through to pg's default URL parsing so the original error surfaces.
  }

  return new Pool({ ...basePoolOptions, ...options, connectionString });
}

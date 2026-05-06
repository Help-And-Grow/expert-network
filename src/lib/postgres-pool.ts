import { Pool, type PoolConfig } from "pg";

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
        ...options,
        connectionString: url.toString(),
        ssl: { rejectUnauthorized: false },
      });
    }
  } catch {
    // Fall through to pg's default URL parsing so the original error surfaces.
  }

  return new Pool({ ...options, connectionString });
}

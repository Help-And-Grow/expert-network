import { Pool, type PoolConfig } from "pg";

export function createPostgresPool(
  connectionString: string,
  options: Omit<PoolConfig, "connectionString" | "ssl"> = {},
): Pool {
  try {
    const url = new URL(connectionString);
    const isSupabase = url.hostname.toLowerCase().includes("supabase.com");

    if (isSupabase) {
      url.searchParams.delete("sslmode");
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

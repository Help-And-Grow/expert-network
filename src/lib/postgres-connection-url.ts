/**
 * Supabase transaction pooler (Supavisor, often port 6543 / *.pooler.supabase.com) does not
 * support prepared statements the same way as a direct session. Prisma + `pg` need
 * `pgbouncer=true` on the URL for pooled connections.
 *
 * Supabase Marketplace URLs also include `sslmode=require`. `pg` currently treats that as
 * certificate-verifying TLS unless `uselibpqcompat=true` is present, which can fail at runtime
 * with SELF_SIGNED_CERT_IN_CHAIN / Prisma P1011 even though Prisma CLI migrations work.
 *
 * @see https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer
 */
export function withSupabasePoolerPrismaParams(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    const host = u.hostname.toLowerCase();
    const port = u.port;
    const isSupabase = host.includes("supabase.com");
    const isPooler = host.includes("pooler.supabase.com") || port === "6543";
    let changed = false;

    if (!u.searchParams.has("pgbouncer")) {
      if (isPooler) {
        u.searchParams.set("pgbouncer", "true");
        changed = true;
      }
    }

    if (isSupabase && u.searchParams.has("sslmode") && !u.searchParams.has("uselibpqcompat")) {
      u.searchParams.set("uselibpqcompat", "true");
      changed = true;
    }

    return changed ? u.toString() : connectionString;
  } catch {
    return connectionString;
  }
}

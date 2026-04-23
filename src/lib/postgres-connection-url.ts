/**
 * Supabase transaction pooler (Supavisor, often port 6543 / *.pooler.supabase.com) does not
 * support prepared statements the same way as a direct session. Prisma + `pg` need
 * `pgbouncer=true` on the URL for pooled connections.
 *
 * @see https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer
 */
export function withSupabasePoolerPrismaParams(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    const host = u.hostname.toLowerCase();
    const port = u.port;
    const isPooler = host.includes("pooler.supabase.com") || port === "6543";
    if (!isPooler) return connectionString;
    if (!u.searchParams.has("pgbouncer")) {
      u.searchParams.set("pgbouncer", "true");
    }
    return u.toString();
  } catch {
    return connectionString;
  }
}

/**
 * User-facing hints for common `pg` errors on HiClaw / DB9 (no secrets).
 */
export function hiClawPgConnectionErrorHint(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes("password authentication failed") || m.includes("28p01")) {
    return (
      "Postgres rejected the password in your connection string. DB9 admin passwords can change, or the URL on Vercel may be outdated. " +
      "This app prefers **DB9_DATABASE_URL** over **HICLAW_POSTGRES_URL**; remove or update a stale HICLAW URL if both are set. " +
      "Get a current DSN from DB9 (e.g. `db9 db connect <database-name>` or `npm run db9:reset-password-vercel` with `DB9_API_KEY` — see https://db9.ai/skill.md), " +
      "then set **DB9_DATABASE_URL** on Vercel Production and redeploy."
    );
  }
  if (m.includes("certificate") || m.includes("ssl") || m.includes("tls")) {
    return (
      "TLS/SSL issue talking to Postgres. For DB9, avoid `sslmode=require` unless their docs say otherwise; try `sslmode=disable` or omit `sslmode` (see https://db9.ai/skill.md)."
    );
  }
  if (m.includes("econnrefused") || m.includes("timeout")) {
    return "Network reachability issue from Vercel to the database host. Confirm the host/port in the URL and that the DB9 instance is active.";
  }
  return undefined;
}

/**
 * User-facing hints for common `pg` errors on HiClaw Postgres (no secrets).
 */
export function hiClawPgConnectionErrorHint(message: string): string | undefined {
  const m = message.toLowerCase();
  if (
    m.includes("expiredsignature") ||
    m.includes("jwt validation failed") ||
    (m.includes("token authentication failed") && m.includes("jwt"))
  ) {
    return (
      "The password in your PostgreSQL URL appears to be a short-lived signed token and has expired. Rotate the connection string in Supabase or your Postgres provider, update Vercel, then redeploy."
    );
  }
  if (m.includes("password authentication failed") || m.includes("28p01")) {
    return (
      "Postgres rejected the password in your connection string. Confirm the DSN in HICLAW_POSTGRES_URL or DATABASE_URL is current, includes the full role and password, then redeploy."
    );
  }
  if (m.includes("certificate") || m.includes("ssl") || m.includes("tls")) {
    return (
      "TLS/SSL issue talking to Postgres. Confirm the provider-specific SSL parameters on the DSN match your Supabase/Postgres project."
    );
  }
  if (m.includes("econnrefused") || m.includes("timeout")) {
    return "Network reachability issue from Vercel to the database host. Confirm the host and port in the DSN and that the Postgres instance is reachable.";
  }
  return undefined;
}

/**
 * Safe diagnostics for HiClaw Postgres URLs (no passwords or secrets in output).
 */

import { Pool } from "pg";

export type PostgresUrlParts = {
  user: string;
  password: string;
  hostport: string;
  pathPart: string;
  query: string;
};

/** Split postgres(ql)://user:password@host:port/db?params — same rules as encodePostgresUrlUserinfo. */
export function splitPostgresUrl(raw: string): PostgresUrlParts | null {
  const s = raw.trim();
  const proto = s.match(/^(postgres(?:ql)?:\/\/)(.*)$/i);
  if (!proto) return null;
  let remainder = proto[2];
  let query = "";
  const qIdx = remainder.indexOf("?");
  if (qIdx >= 0) {
    query = remainder.slice(qIdx);
    remainder = remainder.slice(0, qIdx);
  }
  const slashIdx = remainder.indexOf("/");
  const beforeSlash = slashIdx >= 0 ? remainder.slice(0, slashIdx) : remainder;
  const pathPart = slashIdx >= 0 ? remainder.slice(slashIdx) : "";
  const at = beforeSlash.lastIndexOf("@");
  if (at < 0) return null;
  const userpass = beforeSlash.slice(0, at);
  const hostport = beforeSlash.slice(at + 1);
  const colon = userpass.indexOf(":");
  if (colon < 0) {
    return { user: userpass, password: "", hostport, pathPart, query };
  }
  return {
    user: userpass.slice(0, colon),
    password: userpass.slice(colon + 1),
    hostport,
    pathPart,
    query,
  };
}

export type PasswordHeuristic = {
  length: number;
  /** Looks like a DB9 connect JWT (short-lived). */
  looksLikeJwt: boolean;
  /** Password segment contains %XX sequences (may already be URL-encoded). */
  hasPercentEncoding: boolean;
  /** Raw `=` in password (often needs encoding for URI parsers). */
  hasUnencodedEquals: boolean;
};

export function describePasswordHeuristic(password: string): PasswordHeuristic {
  const length = password.length;
  const dotParts = password.split(".");
  const looksLikeJwt =
    length > 80 && dotParts.length >= 3 && /^[A-Za-z0-9_-]+$/.test(dotParts[0] ?? "");
  const hasPercentEncoding = /%[0-9A-Fa-f]{2}/.test(password);
  const withoutPct = password.replace(/%[0-9A-Fa-f]{2}/g, "");
  const hasUnencodedEquals = withoutPct.includes("=");
  return { length, looksLikeJwt, hasPercentEncoding, hasUnencodedEquals };
}

export type HiClawConnectionProbe = {
  /** Env var that won (e.g. DB9_DATABASE_URL). */
  resolvedSource: string;
  /** Userinfo changed by encode/decode normalization. */
  userinfoNormalizationChanged: boolean;
  host: string | null;
  port: string | null;
  database: string;
  /** Postgres role name only (e.g. e324….admin). */
  user: string;
  password: PasswordHeuristic & { present: boolean };
  /** Query params on the URL (e.g. sslmode). */
  queryKeys: string[];
  /** Human-readable checklist for common misconfigurations. */
  checks: string[];
};

function hostPortFromAuthority(hostport: string): { host: string | null; port: string | null } {
  if (!hostport) return { host: null, port: null };
  if (hostport.startsWith("[")) {
    const end = hostport.indexOf("]");
    if (end < 0) return { host: hostport, port: null };
    const host = hostport.slice(0, end + 1);
    const rest = hostport.slice(end + 1);
    const port = rest.startsWith(":") ? rest.slice(1) : null;
    return { host, port };
  }
  const lastColon = hostport.lastIndexOf(":");
  if (lastColon <= 0 || hostport.includes("]")) {
    return { host: hostport, port: null };
  }
  const maybePort = hostport.slice(lastColon + 1);
  if (/^\d+$/.test(maybePort)) {
    return { host: hostport.slice(0, lastColon), port: maybePort };
  }
  return { host: hostport, port: null };
}

function databaseFromPath(pathPart: string): string {
  if (!pathPart || pathPart === "/") return "postgres";
  return pathPart.replace(/^\//, "").split("/")[0] || "postgres";
}

function queryKeysFromSearch(query: string): string[] {
  if (!query || query === "?") return [];
  const q = query.startsWith("?") ? query.slice(1) : query;
  return q
    .split("&")
    .map((p) => p.split("=")[0])
    .filter(Boolean);
}

export function buildHiClawConnectionProbe(
  resolvedSource: string,
  rawPostgresUrl: string,
  normalizedUrl: string,
): HiClawConnectionProbe | null {
  const rawParts = splitPostgresUrl(rawPostgresUrl);
  const normParts = splitPostgresUrl(normalizedUrl);
  if (!rawParts || !normParts) return null;

  const userinfoNormalizationChanged =
    rawParts.user !== normParts.user || rawParts.password !== normParts.password;

  const { host, port } = hostPortFromAuthority(normParts.hostport);
  const database = databaseFromPath(normParts.pathPart);
  const pwd = normParts.password;
  const heuristic = describePasswordHeuristic(pwd);

  const checks: string[] = [];
  if (!pwd) {
    checks.push(
      "The URL has no password: use postgresql://ROLE:PASSWORD@HOST:PORT/db — for DB9 the role is often tenant.admin; there must be a colon after the role name, then the password, then @ (the role name alone is not the password).",
    );
    checks.push(
      "Fix: run DB9_API_KEY=\"$(db9 token show)\" npm run db9:reset-password-vercel (writes a full URL to Vercel), or paste the full string from DB9. If the dashboard ate the password, use `echo 'URL' | npx vercel env add DB9_DATABASE_URL production --force`.",
    );
  }
  if (heuristic.looksLikeJwt) {
    checks.push(
      "Password looks like a DB9 connect JWT — it expires quickly; use reset-password DSN or refresh connect URL.",
    );
  }
  if (pwd && normParts.user === "admin" && (host?.includes("db9.io") ?? false)) {
    checks.push(
      'User is exactly "admin" on DB9 — the wire role is usually "something.admin". If auth fails with 28P01, re-run `npm run db9:reset-password-vercel` (fixed merge prefers the role from connection_string over JSON admin_user).',
    );
  }
  if (heuristic.hasUnencodedEquals && !heuristic.hasPercentEncoding) {
    checks.push(
      "Password contains raw `=` — app normalizes userinfo (decode→encode); if auth still fails, try `npm run db9:reset-password-vercel` for a fresh admin password.",
    );
  }
  if (userinfoNormalizationChanged) {
    checks.push(
      "Raw env URL differs from normalized URL after userinfo encoding — if “raw” experiment succeeds below, file a bug on normalization.",
    );
  }
  if (host && !host.includes("db9.io") && !host.includes("localhost")) {
    checks.push(`Host is ${host} — confirm this matches your DB9 / HiClaw Postgres instance.`);
  }

  return {
    resolvedSource,
    userinfoNormalizationChanged,
    host,
    port,
    database,
    user: normParts.user,
    password: { ...heuristic, present: Boolean(pwd) },
    queryKeys: queryKeysFromSearch(normParts.query),
    checks,
  };
}

export type ConnectionExperimentResult = {
  label: string;
  ok: boolean;
  error?: string;
  postgresCode?: string;
};

function pgErrorMeta(e: unknown): { message: string; postgresCode?: string } {
  if (e && typeof e === "object" && "message" in e && typeof (e as Error).message === "string") {
    const code =
      "code" in e && typeof (e as { code?: string }).code === "string"
        ? (e as { code?: string }).code
        : undefined;
    return { message: (e as Error).message, postgresCode: code };
  }
  return { message: String(e) };
}

export async function runHiClawConnectionExperiments(
  normalizedUrl: string,
  rawPostgresUrl: string,
): Promise<ConnectionExperimentResult[]> {
  const variants: { label: string; connectionString: string }[] = [
    { label: "normalized (app default)", connectionString: normalizedUrl },
  ];
  if (rawPostgresUrl.trim() !== normalizedUrl.trim()) {
    variants.push({ label: "raw env (no userinfo normalization)", connectionString: rawPostgresUrl.trim() });
  }

  const results: ConnectionExperimentResult[] = [];
  for (const v of variants) {
    const pool = new Pool({
      connectionString: v.connectionString,
      max: 1,
      connectionTimeoutMillis: 10_000,
    });
    try {
      await pool.query("SELECT 1 AS probe");
      results.push({ label: v.label, ok: true });
    } catch (e) {
      const { message, postgresCode } = pgErrorMeta(e);
      results.push({ label: v.label, ok: false, error: message, postgresCode });
    } finally {
      await pool.end().catch(() => {});
    }
  }
  return results;
}

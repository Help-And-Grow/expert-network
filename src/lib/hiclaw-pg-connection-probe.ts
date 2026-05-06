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
  /** Looks like a JWT or opaque signed token. */
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
  /** Env var that won (e.g. HICLAW_POSTGRES_URL). */
  resolvedSource: string;
  /** Raw and normalized URLs differ. */
  userinfoNormalizationChanged: boolean;
  host: string | null;
  port: string | null;
  database: string;
  /** Postgres role name only. */
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
      "The URL has no password. Use a full PostgreSQL URL in the form postgresql://ROLE:PASSWORD@HOST:PORT/db.",
    );
  }
  if (heuristic.looksLikeJwt) {
    checks.push(
      "Password looks like a signed token. If authentication fails, rotate the DSN with your PostgreSQL provider (Cloud SQL: `gcloud sql users set-password ...`) and update Vercel.",
    );
  }
  if (heuristic.hasUnencodedEquals && !heuristic.hasPercentEncoding) {
    checks.push(
      "Password contains raw `=`. URL-encode credentials before saving the DSN if your provider gives a raw password.",
    );
  }
  if (userinfoNormalizationChanged) {
    checks.push(
      "Raw env URL differs from the normalized URL after userinfo encoding. If the raw variant succeeds and the normalized one fails, keep the exact provider-issued DSN.",
    );
  }
  if (host && !host.includes("localhost")) {
    checks.push(`Host is ${host}. Confirm this is the intended PostgreSQL instance for HiClaw.`);
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

import { env } from "@/lib/env";

/** Decode once (if valid) then encode — avoids breaking DB9 DSNs that already ship %-encoded passwords. */
function normalizeUserinfoComponent(part: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(part));
  } catch {
    return encodeURIComponent(part);
  }
}

/**
 * Percent-encode `user` and `password` in `postgres(ql)://user:password@host/...`.
 * - DB9 `db9 db connect` uses a raw JWT as the password; unencoded `=` breaks URI parsing (28P01).
 * - DB9 reset-password / API may return an already-encoded password; encoding again would corrupt it.
 */
export function encodePostgresUrlUserinfo(raw: string): string {
  const s = raw.trim();
  const proto = s.match(/^(postgres(?:ql)?:\/\/)(.*)$/i);
  if (!proto) return s;
  const prefix = proto[1];
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
  if (at < 0) return s;
  const userpass = beforeSlash.slice(0, at);
  const hostport = beforeSlash.slice(at + 1);
  const colon = userpass.indexOf(":");
  if (colon < 0) return s;
  const user = userpass.slice(0, colon);
  const password = userpass.slice(colon + 1);
  if (!password) return s;
  return `${prefix}${normalizeUserinfoComponent(user)}:${normalizeUserinfoComponent(password)}@${hostport}${pathPart}${query}`;
}

export type HiClawDbEnvKey = "HICLAW_POSTGRES_URL" | "DB9_DATABASE_URL" | "TIDB_DATABASE_URL";

export type HiClawUrlScheme = "postgres" | "mysql" | "other" | "missing";

export type HiClawDbCandidate = {
  key: HiClawDbEnvKey;
  isSet: boolean;
  scheme: HiClawUrlScheme;
  host: string | null;
};

export type HiClawDbResolution =
  | { ok: true; url: string; rawPostgresUrl: string; source: HiClawDbEnvKey; candidates: HiClawDbCandidate[] }
  | {
      ok: false;
      source: HiClawDbEnvKey | null;
      candidates: HiClawDbCandidate[];
      error: string;
      hint: string;
    };

/** DB9 first so `npm run db9:*` / provision scripts win over a stale `HICLAW_POSTGRES_URL`. */
const ORDER: HiClawDbEnvKey[] = [
  "DB9_DATABASE_URL",
  "HICLAW_POSTGRES_URL",
  "TIDB_DATABASE_URL",
];

function trimVal(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function classifyUrl(raw: string): { scheme: HiClawUrlScheme; host: string | null } {
  const s = raw.trim();
  if (!s) return { scheme: "missing", host: null };
  if (s.startsWith("mysql://")) {
    try {
      return { scheme: "mysql", host: new URL(s).hostname || null };
    } catch {
      return { scheme: "mysql", host: null };
    }
  }
  if (s.startsWith("postgresql://") || s.startsWith("postgres://")) {
    try {
      return { scheme: "postgres", host: new URL(s).hostname || null };
    } catch {
      return { scheme: "postgres", host: null };
    }
  }
  return { scheme: "other", host: null };
}

function valueForKey(key: HiClawDbEnvKey): string | undefined {
  switch (key) {
    case "HICLAW_POSTGRES_URL":
      return trimVal(env.HICLAW_POSTGRES_URL);
    case "DB9_DATABASE_URL":
      return trimVal(env.DB9_DATABASE_URL);
    case "TIDB_DATABASE_URL":
      return trimVal(env.TIDB_DATABASE_URL);
    default:
      return undefined;
  }
}

/**
 * First **postgresql://** or **postgres://** URL in list order wins: **DB9_DATABASE_URL** →
 * **HICLAW_POSTGRES_URL** → **TIDB_DATABASE_URL**. Non-Postgres values (e.g. legacy `mysql://`) are skipped.
 */
export function resolveHiClawDatabaseUrl(): HiClawDbResolution {
  const candidates: HiClawDbCandidate[] = ORDER.map((key) => {
    const raw = valueForKey(key);
    const isSet = Boolean(raw);
    const { scheme, host } = raw ? classifyUrl(raw) : { scheme: "missing" as const, host: null };
    return { key, isSet, scheme, host };
  });

  for (const key of ORDER) {
    const raw = valueForKey(key);
    if (!raw) continue;
    const u = raw.trim();
    if (u.startsWith("postgresql://") || u.startsWith("postgres://")) {
      return {
        ok: true,
        rawPostgresUrl: u,
        url: encodePostgresUrlUserinfo(u),
        source: key,
        candidates,
      };
    }
  }

  const firstSet = ORDER.map((k) => ({ k, v: valueForKey(k) })).find((x) => x.v);
  if (!firstSet) {
    return {
      ok: false,
      source: null,
      candidates,
      error: "No HiClaw database URL is configured.",
      hint:
        "Set DB9_DATABASE_URL or HICLAW_POSTGRES_URL to a postgresql:// URL on Vercel (Production). If the DB9 CLI fails on your laptop (corporate network), run `npm run db9:provision` from the repo on any machine with Node + Vercel CLI, or paste the URL from Vercel into .env.local for local dev.",
    };
  }

  const winner = firstSet.k;
  const raw = firstSet.v!.trim();

  if (raw.startsWith("mysql://")) {
    const hasOtherSet = ORDER.some((k) => k !== winner && valueForKey(k));
    return {
      ok: false,
      source: winner,
      candidates,
      error: "MySQL URLs are no longer supported — use PostgreSQL for HiClaw.",
      hint:
        hasOtherSet
          ? `${winner} is mysql://, and no variable had a valid postgresql:// URL. Fix or remove ${winner} (it may come from Vercel **Team** env, not the project list). Ensure DB9_DATABASE_URL is a complete postgresql:// connection string.`
          : winner === "TIDB_DATABASE_URL"
            ? "Legacy TIDB_DATABASE_URL is mysql://. Remove it or replace with postgresql://. Prefer DB9_DATABASE_URL on Vercel."
            : `${winner} points at mysql://. Replace with postgresql:// (e.g. DB9) or unset it so DB9_DATABASE_URL is used.`,
    };
  }

  return {
    ok: false,
    source: winner,
    candidates,
    error: "HiClaw database URL must be PostgreSQL (postgresql:// or postgres://).",
    hint: `Check ${winner} — it must start with postgresql:// or postgres://.`,
  };
}

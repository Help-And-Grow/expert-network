import { env } from "@/lib/env";

export type HiClawDbEnvKey = "HICLAW_POSTGRES_URL" | "DATABASE_URL";

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

const ORDER: HiClawDbEnvKey[] = ["HICLAW_POSTGRES_URL", "DATABASE_URL"];

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
    case "DATABASE_URL":
      return trimVal(env.DATABASE_URL);
    default:
      return undefined;
  }
}

/**
 * First valid PostgreSQL URL wins: dedicated HiClaw URL first, otherwise the app DATABASE_URL.
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
        url: u,
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
        "Set HICLAW_POSTGRES_URL to a direct PostgreSQL URL, or let HiClaw reuse DATABASE_URL so the marketplace and HiClaw share the same Supabase Postgres instance.",
    };
  }

  const winner = firstSet.k;
  const raw = firstSet.v!.trim();

  if (raw.startsWith("mysql://")) {
    return {
      ok: false,
      source: winner,
      candidates,
      error: "MySQL URLs are no longer supported — use PostgreSQL for HiClaw.",
      hint:
        `${winner} points at mysql://. Replace it with a Supabase/Postgres connection string.`,
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

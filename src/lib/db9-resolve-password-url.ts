/**
 * Keep logic in sync with `scripts/db9-merge-connection-string.mjs` (db9-provision CLI).
 * DB9 may return connection_string without :password@ and put secrets in admin_* fields.
 */

export function postgresUserinfoHasPassword(url: string): boolean {
  const s = typeof url === "string" ? url.trim() : "";
  if (!s || (!s.startsWith("postgres://") && !s.startsWith("postgresql://"))) return false;
  const m = s.match(/^postgres(?:ql)?:\/\/([^/?#]+)@/i);
  if (!m) return false;
  return m[1].includes(":");
}

export function pickString(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function extractUserFromPasswordlessPostgresUrl(url: string): string {
  const m = String(url)
    .trim()
    .match(/^postgres(?:ql)?:\/\/([^/?#]+)@/i);
  if (!m) return "";
  const userpart = m[1];
  if (userpart.includes(":")) return userpart.slice(0, userpart.indexOf(":"));
  return userpart;
}

export function mergePasswordIntoPostgresUrl(
  url: string,
  password: string,
  explicitUserFallback?: string,
): string {
  const p = String(password).trim();
  if (!p) return String(url).trim();
  const s = String(url).trim();
  const m = s.match(/^(postgres(?:ql)?:\/\/)([^/?#]+)@(.+)$/i);
  if (!m) return s;
  const userpart = m[2];
  const rest = m[3];
  if (userpart.includes(":")) return s;
  const user =
    String(userpart).trim() ||
    (explicitUserFallback && String(explicitUserFallback).trim()) ||
    "";
  if (!user) return s;
  return `${m[1]}${encodeURIComponent(user)}:${encodeURIComponent(p)}@${rest}`;
}

type ApiJsonFn = (
  method: string,
  pathname: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

export async function resolvePasswordBearingDb9Url(
  dbId: string,
  data: Record<string, unknown>,
  apiJson: ApiJsonFn,
): Promise<string> {
  let cs = pickString(data, ["connection_string", "connectionString"]);
  if (!cs) {
    throw new Error(
      "DB9 reset-password missing connection_string. Keys: " + Object.keys(data).join(", "),
    );
  }

  const adminPass = pickString(data, [
    "admin_password",
    "adminPassword",
    "password",
    "new_password",
    "newPassword",
  ]);
  const adminUser = pickString(data, ["admin_user", "adminUser", "username"]);

  if (!postgresUserinfoHasPassword(cs) && adminPass) {
    const urlUser = extractUserFromPasswordlessPostgresUrl(cs);
    if (!urlUser && !adminUser) {
      throw new Error(
        "DB9 returned a separate password but no user — cannot build URL. Keys: " +
          Object.keys(data).join(", "),
      );
    }
    cs = mergePasswordIntoPostgresUrl(cs, adminPass, adminUser);
  }

  if (!postgresUserinfoHasPassword(cs)) {
    try {
      const creds = await apiJson("GET", `/customer/databases/${dbId}/credentials`);
      const cs2 = pickString(creds, ["connection_string", "connectionString"]);
      const p2 = pickString(creds, ["admin_password", "adminPassword", "password"]);
      const u2 = pickString(creds, ["admin_user", "adminUser"]);
      if (cs2 && postgresUserinfoHasPassword(cs2)) {
        cs = cs2;
      } else if (p2) {
        const base = cs2 || cs;
        const user = extractUserFromPasswordlessPostgresUrl(base) || u2;
        if (user) {
          cs = mergePasswordIntoPostgresUrl(base, p2, user);
        }
      }
    } catch {
      /* 410 passwordless or network */
    }
  }

  if (!postgresUserinfoHasPassword(cs)) {
    throw new Error(
      "DB9 did not yield a password-bearing postgresql:// URL (no :password@). " +
        "Reset response keys: " +
        Object.keys(data).join(", ") +
        ". Try `db9 db connect <db>` or paste the full DSN into Vercel.",
    );
  }

  return cs.trim();
}

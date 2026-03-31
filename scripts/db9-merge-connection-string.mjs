/**
 * DB9 sometimes returns connection_string without :password@ while putting the secret in
 * admin_password / admin_user. Vercel then stores a useless URL. Merge + optional GET /credentials.
 */

export function postgresUserinfoHasPassword(url) {
  const s = typeof url === "string" ? url.trim() : "";
  if (!s || (!s.startsWith("postgres://") && !s.startsWith("postgresql://"))) return false;
  const m = s.match(/^postgres(?:ql)?:\/\/([^/?#]+)@/i);
  if (!m) return false;
  return m[1].includes(":");
}

export function pickString(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function extractUserFromPasswordlessPostgresUrl(url) {
  const m = String(url)
    .trim()
    .match(/^postgres(?:ql)?:\/\/([^/?#]+)@/i);
  if (!m) return "";
  const userpart = m[1];
  if (userpart.includes(":")) return userpart.slice(0, userpart.indexOf(":"));
  return userpart;
}

/** Insert :password into postgresql://user@host/... (user part must not already contain :). */
export function mergePasswordIntoPostgresUrl(url, password, explicitUserFallback) {
  const p = String(password).trim();
  if (!p) return String(url).trim();
  const s = String(url).trim();
  const m = s.match(/^(postgres(?:ql)?:\/\/)([^/?#]+)@(.+)$/i);
  if (!m) return s;
  const userpart = m[2];
  const rest = m[3];
  if (userpart.includes(":")) return s;
  // DB9 connection_string uses full pg role (e.g. tenant.admin); admin_user in JSON is often "admin" only — wrong for SCRAM.
  const user =
    String(userpart).trim() ||
    (explicitUserFallback && String(explicitUserFallback).trim()) ||
    "";
  if (!user) return s;
  return `${m[1]}${encodeURIComponent(user)}:${encodeURIComponent(p)}@${rest}`;
}

/**
 * @param {string} dbId
 * @param {Record<string, unknown>} data - JSON body from POST .../reset-password (or { connection_string } only)
 * @param {(method: string, pathname: string, body?: unknown) => Promise<Record<string, unknown>>} apiJson
 */
export async function resolvePasswordBearingDb9Url(dbId, data, apiJson) {
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
    console.error("[db9-provision] Built password-bearing URL from DB9 password fields + connection_string.");
  }

  if (!postgresUserinfoHasPassword(cs)) {
    try {
      const creds = await apiJson("GET", `/customer/databases/${dbId}/credentials`);
      const cs2 = pickString(creds, ["connection_string", "connectionString"]);
      const p2 = pickString(creds, ["admin_password", "adminPassword", "password"]);
      const u2 = pickString(creds, ["admin_user", "adminUser"]);
      if (cs2 && postgresUserinfoHasPassword(cs2)) {
        cs = cs2;
        console.error("[db9-provision] Using password-bearing connection_string from GET /credentials.");
      } else if (p2) {
        const base = cs2 || cs;
        const user = extractUserFromPasswordlessPostgresUrl(base) || u2;
        if (user) {
          cs = mergePasswordIntoPostgresUrl(base, p2, user);
          console.error("[db9-provision] Built URL from GET /credentials admin fields.");
        }
      }
    } catch (e) {
      console.error(
        "[db9-provision] GET /credentials failed (passwordless mode or network):",
        e?.message || e,
      );
    }
  }

  if (!postgresUserinfoHasPassword(cs)) {
    throw new Error(
      "DB9 did not yield a password-bearing postgresql:// URL (no :password@). " +
        "Reset response keys: " +
        Object.keys(data).join(", ") +
        ". Try `db9 db connect <db>` or paste the full DSN manually into Vercel.",
    );
  }

  return cs.trim();
}

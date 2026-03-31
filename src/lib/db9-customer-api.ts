/**
 * DB9 Customer HTTP API (https://api.db9.ai) — same surface as `scripts/db9-provision.mjs`.
 * Only call from trusted server code; never expose tokens to clients except via one-shot admin flows.
 */
import {
  postgresUserinfoHasPassword,
  resolvePasswordBearingDb9Url,
} from "@/lib/db9-resolve-password-url";

const DB9_API = "https://api.db9.ai";

export type Db9DatabaseSummary = { id: string; name: string; state?: string };

export class Db9ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "Db9ApiError";
  }
}

async function db9FetchJson(
  token: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`${DB9_API}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!r.ok) {
    const msg =
      typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : text.slice(0, 300);
    throw new Db9ApiError(`${method} ${pathname} → ${r.status}: ${msg}`, r.status);
  }
  return parsed;
}

export async function db9ListDatabases(token: string): Promise<Db9DatabaseSummary[]> {
  const list = await db9FetchJson(token, "GET", "/customer/databases");
  if (Array.isArray(list)) return list as Db9DatabaseSummary[];
  if (list && typeof list === "object" && "databases" in list && Array.isArray((list as { databases: unknown }).databases)) {
    return (list as { databases: Db9DatabaseSummary[] }).databases;
  }
  return [];
}

export async function db9GetDatabaseDetail(token: string, databaseId: string): Promise<{
  id: string;
  connection_string?: string;
}> {
  const detail = await db9FetchJson(token, "GET", `/customer/databases/${databaseId}`);
  return detail as { id: string; connection_string?: string };
}

export async function db9FetchConnectionStringForDatabase(
  token: string,
  databaseName: string,
  mode: "current" | "reset_password",
): Promise<{ databaseId: string; connectionString: string }> {
  const rows = await db9ListDatabases(token);
  const existing = rows.find((d) => d.name === databaseName);
  if (!existing?.id) {
    throw new Db9ApiError(`No database named "${databaseName}" for this DB9 token.`, 404);
  }
  if (mode === "reset_password") {
    try {
      const raw = await db9FetchJson(
        token,
        "POST",
        `/customer/databases/${existing.id}/reset-password`,
        {},
      );
      const payload =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const fetcher = (method: string, pathname: string, body?: unknown) =>
        db9FetchJson(token, method, pathname, body).then((j) =>
          j && typeof j === "object" && j !== null ? (j as Record<string, unknown>) : {},
        );
      const connectionString = await resolvePasswordBearingDb9Url(existing.id, payload, fetcher);
      return { databaseId: existing.id, connectionString };
    } catch (e) {
      if (e instanceof Db9ApiError && e.status === 410) {
        throw new Db9ApiError(
          "DB9 returned 410: password reset disabled (passwordless mode). Use `db9 db connect <db>` for a short-lived DSN (see db9.ai/skill.md).",
          410,
        );
      }
      throw e;
    }
  }
  const detail = await db9GetDatabaseDetail(token, existing.id);
  let connectionString = detail.connection_string?.trim();
  if (!connectionString) {
    throw new Db9ApiError("DB9 database detail had no connection_string.", 502);
  }
  if (!postgresUserinfoHasPassword(connectionString)) {
    const fetcher = (method: string, pathname: string, body?: unknown) =>
      db9FetchJson(token, method, pathname, body).then((j) =>
        j && typeof j === "object" && j !== null ? (j as Record<string, unknown>) : {},
      );
    connectionString = await resolvePasswordBearingDb9Url(
      existing.id,
      { connection_string: connectionString },
      fetcher,
    );
  }
  return { databaseId: detail.id, connectionString };
}

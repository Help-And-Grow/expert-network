import pg from "pg";
import { v4 as uuidv4 } from "uuid";

const pgUrl = process.env.DB9_DATABASE_URL || process.env.HICLAW_POSTGRES_URL;

/** Full URL for DB9 (or compatible) HTTP SQL endpoint — POST JSON body, Bearer auth. */
const httpSqlUrl = (process.env.DB9_HTTP_SQL_URL || process.env.DB9_DATABASE_HTTP_URL || "")
  .trim()
  .replace(/\/$/, "");
const httpSqlToken =
  process.env.DB9_HTTP_SQL_TOKEN || process.env.DB9_API_KEY || "";

if (!httpSqlUrl && !pgUrl) {
  console.warn(
    "[store] Set DB9_HTTP_SQL_URL (HTTP) or DB9_DATABASE_URL / HICLAW_POSTGRES_URL (TCP pg).",
  );
}

const pgPool = pgUrl && !httpSqlUrl ? new pg.Pool({ connectionString: pgUrl }) : null;

function toPgSql(sql, params) {
  let n = 0;
  const text = sql.replace(/\?/g, () => `$${++n}`);
  return { text, values: params };
}

/**
 * Execute SQL via DB9-style HTTP API when DB9_HTTP_SQL_URL + DB9_HTTP_SQL_TOKEN are set;
 * otherwise use the pg pool.
 */
async function executeHttp(sql, params = []) {
  const { text, values } = toPgSql(sql, params);
  const res = await fetch(httpSqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${httpSqlToken}`,
    },
    body: JSON.stringify({
      query: text,
      sql: text,
      params: values,
      arguments: values,
    }),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`[store] HTTP SQL ${res.status}: ${rawText.slice(0, 500)}`);
  }
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error("[store] HTTP SQL response was not JSON");
  }
  const rows =
    json.rows ??
    json.data?.rows ??
    json.result?.rows ??
    json.records ??
    (Array.isArray(json) ? json : []);
  if (!Array.isArray(rows)) {
    console.warn("[store] HTTP SQL: unexpected shape, returning []");
    return [];
  }
  return rows;
}

/** @param {string} sql @param {unknown[]} [params] */
export async function execute(sql, params = []) {
  if (httpSqlUrl && httpSqlToken) {
    return executeHttp(sql, params);
  }
  if (!pgPool) {
    throw new Error(
      "No database configured. Set DB9_HTTP_SQL_URL + DB9_HTTP_SQL_TOKEN, or DB9_DATABASE_URL.",
    );
  }
  const { text, values } = toPgSql(sql, params);
  const r = await pgPool.query(text, values);
  return r.rows;
}

export function usingPostgres() {
  return !!pgPool || (!!httpSqlUrl && !!httpSqlToken);
}

export function usingHttpSql() {
  return !!(httpSqlUrl && httpSqlToken);
}

export async function checkExpertStatus(expertId) {
  const rows = await execute(
    "SELECT is_online, last_seen FROM expert_status WHERE expert_id = ?",
    [expertId],
  );
  if (rows.length === 0) return { isOnline: false, lastSeen: null };
  const row = rows[0];
  return {
    isOnline: !!row.is_online,
    lastSeen: row.last_seen,
  };
}

export async function updateExpertStatus(expertId, isOnline) {
  await execute(
    `INSERT INTO expert_status (expert_id, is_online, last_seen)
     VALUES (?, ?, NOW())
     ON CONFLICT (expert_id) DO UPDATE SET
       is_online = EXCLUDED.is_online,
       last_seen = NOW()`,
    [expertId, isOnline],
  );
}

export async function createSession({
  id,
  expertId,
  menteeId,
  query,
  conversationMessages = null,
  mem9ProfileSummary = null,
  handoffArtifact = null,
}) {
  await execute(
    `INSERT INTO sessions (id, expert_id, mentee_id, query, status, created_at,
      conversation_messages, mem9_profile_summary, handoff_artifact)
     VALUES (?, ?, ?, ?, 'pending', NOW(), ?, ?, ?)`,
    [
      id,
      expertId,
      menteeId,
      query,
      conversationMessages,
      mem9ProfileSummary,
      handoffArtifact,
    ],
  );
}

export async function getSession(sessionId) {
  const rows = await execute("SELECT * FROM sessions WHERE id = ?", [sessionId]);
  return rows[0] || null;
}

export async function updateSession(sessionId, data) {
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
    sets.push(`${col} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  values.push(sessionId);
  await execute(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function getSessionsByExpert(expertId, status) {
  return execute(
    "SELECT * FROM sessions WHERE expert_id = ? AND status = ? ORDER BY created_at DESC",
    [expertId, status],
  );
}

export async function insertEvaluatorCritique({
  sessionId,
  draftRound,
  passed,
  scoresJson,
  critique,
  draftExcerpt,
}) {
  const id = uuidv4();
  await execute(
    `INSERT INTO evaluator_critiques
     (id, session_id, draft_round, passed, scores, critique, draft_excerpt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      id,
      sessionId,
      draftRound,
      passed,
      typeof scoresJson === "string" ? scoresJson : JSON.stringify(scoresJson ?? {}),
      critique,
      draftExcerpt,
    ],
  );
}

/** @deprecated Use execute(); kept for legacy imports */
export const pool = {
  execute: async (sql, params) => {
    const rows = await execute(sql, params);
    return [rows];
  },
};

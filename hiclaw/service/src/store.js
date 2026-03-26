import mysql from "mysql2/promise";
import pg from "pg";
import { v4 as uuidv4 } from "uuid";

const pgUrl = process.env.HICLAW_POSTGRES_URL || process.env.DB9_DATABASE_URL;
const mysqlUrl = process.env.TIDB_DATABASE_URL;

let isPostgres = false;
let mysqlPool = null;
let pgPool = null;

if (pgUrl) {
  isPostgres = true;
  pgPool = new pg.Pool({ connectionString: pgUrl });
} else if (mysqlUrl) {
  mysqlPool = mysql.createPool({
    uri: mysqlUrl,
    waitForConnections: true,
    connectionLimit: 10,
    ssl: { rejectUnauthorized: true },
  });
} else {
  console.warn(
    "[store] Set TIDB_DATABASE_URL (MySQL) or HICLAW_POSTGRES_URL / DB9_DATABASE_URL (Postgres)."
  );
}

function toPgSql(sql, params) {
  let n = 0;
  const text = sql.replace(/\?/g, () => `$${++n}`);
  return { text, values: params };
}

/** @param {string} sql @param {unknown[]} [params] */
export async function execute(sql, params = []) {
  if (isPostgres) {
    const { text, values } = toPgSql(sql, params);
    const r = await pgPool.query(text, values);
    return r.rows;
  }
  if (!mysqlPool) throw new Error("No database configured");
  const [rows] = await mysqlPool.execute(sql, params);
  return rows;
}

export function usingPostgres() {
  return isPostgres;
}

export async function checkExpertStatus(expertId) {
  const rows = await execute(
    "SELECT is_online, last_seen FROM expert_status WHERE expert_id = ?",
    [expertId]
  );
  if (rows.length === 0) return { isOnline: false, lastSeen: null };
  const row = rows[0];
  return {
    isOnline: !!row.is_online,
    lastSeen: row.last_seen,
  };
}

export async function updateExpertStatus(expertId, isOnline) {
  if (isPostgres) {
    await execute(
      `INSERT INTO expert_status (expert_id, is_online, last_seen)
       VALUES (?, ?, NOW())
       ON CONFLICT (expert_id) DO UPDATE SET
         is_online = EXCLUDED.is_online,
         last_seen = NOW()`,
      [expertId, isOnline]
    );
    return;
  }
  await execute(
    `INSERT INTO expert_status (expert_id, is_online, last_seen)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE is_online = VALUES(is_online), last_seen = NOW()`,
    [expertId, isOnline]
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
    ]
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
    [expertId, status]
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
    ]
  );
}

/** @deprecated Use execute(); kept for legacy imports */
export const pool = {
  execute: async (sql, params) => {
    const rows = await execute(sql, params);
    return [rows];
  },
};

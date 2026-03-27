/**
 * HiClaw **agent session** store for on-chain sync + reputation (was TiDB/MySQL).
 * Requires a **PostgreSQL** URL — same database HiClaw `store.js` uses when deployed.
 *
 * Env (first match wins): `HICLAW_POSTGRES_URL`, `DB9_DATABASE_URL`, or legacy
 * `TIDB_DATABASE_URL` **only if** it is a `postgres://` / `postgresql://` URL.
 */
import { Pool } from "pg";

let pool: Pool | null = null;

function getHiClawPostgresUrl(): string {
  const raw =
    process.env.HICLAW_POSTGRES_URL ||
    process.env.DB9_DATABASE_URL ||
    process.env.TIDB_DATABASE_URL;

  if (!raw?.trim()) {
    throw new Error(
      "Set HICLAW_POSTGRES_URL or DB9_DATABASE_URL (PostgreSQL) for HiClaw sessions — used by on-chain webhook and /api/reputation.",
    );
  }
  const url = raw.trim();
  if (url.startsWith("mysql://")) {
    throw new Error(
      "MySQL/TiDB URLs are no longer supported. Point HICLAW_POSTGRES_URL (or DB9_DATABASE_URL) at the same Postgres HiClaw uses.",
    );
  }
  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    throw new Error(
      "HiClaw session database must be PostgreSQL (postgresql:// or postgres://).",
    );
  }
  return url;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getHiClawPostgresUrl(),
      max: 5,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export type OnChainSessionUpdate = {
  txHash: string;
  easAttestationUid: string;
};

export async function updateSessionOnChain(
  sessionHash: string,
  opts: OnChainSessionUpdate,
) {
  const p = getPool();
  const hashNorm = sessionHash.trim().toLowerCase();
  await p.query(
    `UPDATE sessions SET on_chain_verified = TRUE, tx_hash = $1, eas_attestation_uid = $2
     WHERE LOWER(session_hash) = $3`,
    [opts.txHash, opts.easAttestationUid, hashNorm],
  );
}

export interface ReputationData {
  totalSBTs: number;
  menteeCount: number;
  topics: string[];
  attestationUidList: string[];
}

export async function getExpertReputation(
  expertId: string,
): Promise<ReputationData> {
  const p = getPool();

  const countRows = await p.query<{ total: string }>(
    `SELECT COUNT(*)::text as total FROM sessions WHERE expert_id = $1 AND on_chain_verified = TRUE`,
    [expertId],
  );

  const menteeRows = await p.query<{ cnt: string }>(
    `SELECT COUNT(DISTINCT mentee_id)::text as cnt FROM sessions WHERE expert_id = $1 AND on_chain_verified = TRUE`,
    [expertId],
  );

  const topicRows = await p.query<{ topic: string }>(
    `SELECT DISTINCT query as topic FROM sessions WHERE expert_id = $1 AND on_chain_verified = TRUE AND query IS NOT NULL LIMIT 20`,
    [expertId],
  );

  const uidRows = await p.query<{ eas_attestation_uid: string }>(
    `SELECT eas_attestation_uid FROM sessions WHERE expert_id = $1 AND on_chain_verified = TRUE AND eas_attestation_uid IS NOT NULL ORDER BY created_at DESC`,
    [expertId],
  );

  return {
    totalSBTs: Number(countRows.rows[0]?.total ?? 0),
    menteeCount: Number(menteeRows.rows[0]?.cnt ?? 0),
    topics: topicRows.rows.map((r) => r.topic).filter(Boolean),
    attestationUidList: uidRows.rows
      .map((r) => r.eas_attestation_uid)
      .filter(Boolean),
  };
}

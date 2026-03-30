/**
 * HiClaw **agent session** store for on-chain sync + reputation (was TiDB/MySQL).
 * Requires a **PostgreSQL** URL — same database HiClaw `store.js` uses when deployed.
 *
 * Env: first **valid** `postgres://` / `postgresql://` among `HICLAW_POSTGRES_URL`,
 * `DB9_DATABASE_URL`, `TIDB_DATABASE_URL` (skips `mysql://` so DB9 can win).
 */
import { Pool } from "pg";

import { resolveHiClawDatabaseUrl } from "@/lib/hiclaw-db-env";

let pool: Pool | null = null;

function getHiClawPostgresUrl(): string {
  const r = resolveHiClawDatabaseUrl();
  if (!r.ok) {
    throw new Error(`${r.error} ${r.hint}`);
  }
  return r.url;
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

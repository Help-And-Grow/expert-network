import { env } from "@/lib/env";
import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    const url = env.TIDB_DATABASE_URL;
    if (!url) throw new Error("TIDB_DATABASE_URL is not set");
    pool = mysql.createPool({
      uri: url,
      waitForConnections: true,
      connectionLimit: 5,
      ssl: { rejectUnauthorized: true },
    });
  }
  return pool;
}

export type OnChainSessionUpdate = {
  txHash: string;
  easAttestationUid: string;
};

export async function updateSessionOnChain(sessionHash: string, opts: OnChainSessionUpdate) {
  const p = getPool();
  const hashNorm = sessionHash.trim().toLowerCase();
  await p.execute(
    `UPDATE sessions SET on_chain_verified = TRUE, tx_hash = ?, eas_attestation_uid = ?
     WHERE LOWER(session_hash) = ?`,
    [opts.txHash, opts.easAttestationUid, hashNorm]
  );
}

export interface ReputationData {
  totalSBTs: number;
  menteeCount: number;
  topics: string[];
  attestationUidList: string[];
}

export async function getExpertReputation(expertId: string): Promise<ReputationData> {
  const p = getPool();

  const [countRows] = (await p.execute(
    `SELECT COUNT(*) as total FROM sessions WHERE expert_id = ? AND on_chain_verified = TRUE`,
    [expertId]
  )) as [Array<{ total: number }>, unknown];

  const [menteeRows] = (await p.execute(
    `SELECT COUNT(DISTINCT mentee_id) as cnt FROM sessions WHERE expert_id = ? AND on_chain_verified = TRUE`,
    [expertId]
  )) as [Array<{ cnt: number }>, unknown];

  const [topicRows] = (await p.execute(
    `SELECT DISTINCT query as topic FROM sessions WHERE expert_id = ? AND on_chain_verified = TRUE AND query IS NOT NULL LIMIT 20`,
    [expertId]
  )) as [Array<{ topic: string }>, unknown];

  const [uidRows] = (await p.execute(
    `SELECT eas_attestation_uid FROM sessions WHERE expert_id = ? AND on_chain_verified = TRUE AND eas_attestation_uid IS NOT NULL ORDER BY created_at DESC`,
    [expertId]
  )) as [Array<{ eas_attestation_uid: string }>, unknown];

  return {
    totalSBTs: Number(countRows[0]?.total ?? 0),
    menteeCount: Number(menteeRows[0]?.cnt ?? 0),
    topics: topicRows.map((r) => r.topic).filter(Boolean),
    attestationUidList: uidRows.map((r) => r.eas_attestation_uid).filter(Boolean),
  };
}

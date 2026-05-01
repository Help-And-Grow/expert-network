#!/usr/bin/env node
/**
 * 定时 ETL：Supabase → 腾讯云新加坡 PG
 *
 * 用法：
 *   node scripts/sync-supabase-to-tc-sg.mjs
 *
 * 环境变量：
 *   SUPABASE_URL            Supabase 项目 URL
 *   SUPABASE_SERVICE_KEY   Supabase Service Role Key
 *   TC_SG_DATABASE_URL    腾讯云新加坡 PG 连接串
 *   SYNC_STATE_FILE        同步状态文件路径（默认 ./scripts/.sync-state.json）
 *
 * 同步策略：
 *   1. 读取上次同步时间（sync_state.json）
 *   2. 从 Supabase 拉取 `updated_at > last_sync_time` 的记录
 *   3. Upsert 到腾讯云新加坡 PG
 *   4. 更新同步时间
 */

import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- 配置 ----------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TC_SG_DATABASE_URL = process.env.TC_SG_DATABASE_URL;
const SYNC_STATE_FILE = process.env.SYNC_STATE_FILE ||
  resolve(__dirname, ".sync-state.json");

/** 同步表顺序（先父表后子表）*/
const TABLES = [
  { name: "User",       columns: ["id", "name", "avatar_url", "created_at", "updated_at"] },
  { name: "Expert",     columns: ["id", "user_id", "bio", "is_published", "price_online_cents", "price_offline_cents", "created_at", "updated_at"] },
  { name: "Booking",    columns: ["id", "expert_id", "player_id", "status", "session_type", "scheduled_at", "created_at", "updated_at"] },
  { name: "Review",     columns: ["id", "booking_id", "reviewer_id", "rating", "comment", "created_at", "updated_at"] },
];

// ---------- 同步状态 ----------

function loadSyncState() {
  try {
    if (existsSync(SYNC_STATE_FILE)) {
      return JSON.parse(readFileSync(SYNC_STATE_FILE, "utf8"));
    }
  } catch {}
  return { last_sync: null, table_state: {} };
}

function saveSyncState(state) {
  writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// ---------- 核心逻辑 ----------

async function syncTable(tableName, columns, supabase, pg, lastSync) {
  console.log(`[sync] Syncing ${tableName}...`);

  // 1. 从 Supabase 拉取变更
  let query = supabase
    .from(tableName)
    .select(columns.join(","))
    .order("updated_at", { ascending: true });

  if (lastSync) {
    query = query.gt("updated_at", lastSync);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`[sync] Failed to fetch ${tableName}:`, error.message);
    return 0;
  }
  if (!data || data.length === 0) {
    console.log(`[sync] ${tableName}: no changes`);
    return 0;
  }

  console.log(`[sync] ${tableName}: ${data.length} records to sync`);

  // 2. Upsert 到腾讯云 SG
  const columnList = columns.map((c) => `"${c}"`).join(", ");
  const valuePlaceholders = data.map((_, rowIdx) =>
    `(${columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(", ")})`
  ).join(", ");
  const updateSet = columns
    .filter((c) => c !== "id")
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");

  // 分批（每批 100 条）
  const BATCH = 100;
  let totalUpserted = 0;

  for (let i = 0; i < data.length; i += BATCH) {
    const batch = data.slice(i, i + BATCH);
    const values = [];
    for (const row of batch) {
      for (const col of columns) {
        values.push(row[col]);
      }
    }

    const placeholders = batch.map((_, rowIdx) =>
      `(${columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(", ")})`
    ).join(", ");

    const sql = `
      INSERT INTO "${tableName}" (${columnList})
      VALUES ${placeholders}
      ON CONFLICT (id) DO UPDATE SET ${updateSet};
    `;

    try {
      await pg.query(sql, values);
      totalUpserted += batch.length;
      console.log(`[sync] ${tableName}: upserted ${totalUpserted}/${data.length}`);
    } catch (err) {
      console.error(`[sync] Failed to upsert ${tableName}:`, err.message);
      throw err;
    }
  }

  return totalUpserted;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TC_SG_DATABASE_URL) {
    console.error(
      "Missing env vars. Required: SUPABASE_URL, SUPABASE_SERVICE_KEY, TC_SG_DATABASE_URL"
    );
    process.exit(2);
  }

  const state = loadSyncState();
  const lastSync = state.last_sync || null;

  console.log(`[sync] Starting sync (last_sync=${lastSync || "NEVER"})...`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const pg = new Client({ connectionString: TC_SG_DATABASE_URL });
  await pg.connect();

  try {
    for (const tbl of TABLES) {
      const count = await syncTable(tbl.name, tbl.columns, supabase, pg, lastSync);
      state.table_state[tbl.name] = {
        last_sync: new Date().toISOString(),
        records_synced: count,
      };
    }

    state.last_sync = new Date().toISOString();
    saveSyncState(state);
    console.log(`[sync] Done. next_sync starts from ${state.last_sync}`);
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error("[sync] Fatal error:", err);
  process.exit(1);
});

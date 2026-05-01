# Supabase → 腾讯云新加坡 数据库同步方案

> 状态：设计方案
> 作者：AI Assistant
> 日期：2026-05-01

## 目标

将 Supabase（主库，面向 Web / Telegram 用户）的数据**每日单向同步**到腾讯云新加坡节点的 PostgreSQL（面向海外 WeChat 小程序用户），确保两个微信小程序（国内版 / 海外版）的数据隔离合规，同时让通过 Web/Telegram 入驻的专家数据在海外 WeChat 小程序中可见。

## 同步范围

仅同步**公开可读**的数据（海外 WeChat 用户只读，不反向同步）：

| 表 | 同步 | 说明 |
|----|------|------|
| `User` | ✅ | 用户公开资料（昵称、头像） |
| `Expert` | ✅ | 专家档案（服务、定价、简介） |
| `Booking` | ✅（仅已完成/公开） | 见面记录（用于展示专家经验） |
| `Review` | ✅ | 评价（公开） |
| `Account`, `Session`, `Payment` 等 | ❌ | 敏感/私有数据不同步 |

## 方案 A：PostgreSQL 逻辑复制（首选）

### 架构

```
Supabase (Publisher)         腾讯云新加坡 PG (Subscriber)
┌─────────────────┐         ┌──────────────────────┐
│  publication     │ ──────→ │  subscription        │
│  wechat_sg_pub  │  WAL    │  wechat_sg_sub      │
└─────────────────┘ 流式复制 └──────────────────────┘
```

### Step 1：Supabase 端配置

```sql
-- 1. 创建 publication（在 Supabase SQL Editor 中执行）
CREATE PUBLICATION wechat_sg_pub
  FOR TABLE "User", "Expert", "Booking", "Review"
  WITH (publish = 'insert, update, delete');

-- 2. 确认 WAL 级别（Supabase 默认已为 logical）
SHOW wal_level;  -- 应返回 'logical'

-- 3. 获取 Supabase 连接信息
-- Dashboard → Project Settings → Database → Connection string
-- 建议使用 Connection Pooling 地址（端口 6543）
```

### Step 2：腾讯云新加坡端配置

```sql
-- 在腾讯云新加坡 PG 中执行
CREATE SUBSCRIPTION wechat_sg_sub
  CONNECTION 'host=xxx.pooler.supabase.com port=6543 dbname=postgres user=postgres password=<supabase_password> sslmode=require'
  PUBLICATION wechat_sg_pub
  WITH (
    copy_data = true,        -- 初始化时复制存量数据
    synchronous_commit = 'off'  -- 异步提交，降低延迟
  );
```

### Step 3：网络打通

逻辑复制要求 Subscriber 能访问 Publisher：

1. **Supabase 侧**：在 Dashboard → Authentication → Configuration → **Allowed IP Addresses**，添加腾讯云新加坡服务器的出口 IP。
2. **腾讯云侧**：确保安全组出站规则允许到 Supabase 端口（5432 或 6543）的访问。

> ⚠️ 如果 Supabase 的 IP 白名单功能不够灵活，可改用 **方案 B（ETL 脚本）** 作为降级方案。

### 监控

```sql
-- 在腾讯云 SG 端查看同步状态
SELECT * FROM pg_stat_subscription;

-- 查看复制延迟
SELECT
  subname,
  pid,
  received_lsn,
  latest_end_lsn,
  latest_end_time
FROM pg_stat_subscription;
```

---

## 方案 B：定时 ETL 脚本（降级/补充方案）

当逻辑复制因网络策略无法打通时，使用定时脚本同步。

### 实现（`scripts/sync-supabase-to-tc-sg.mjs`）

```javascript
#!/usr/bin/env node
/**
 * 每日定时同步：Supabase → 腾讯云新加坡 PG
 *
 * 用法：
 *   node scripts/sync-supabase-to-tc-sg.mjs
 *
 * 环境变量：
 *   SUPABASE_URL          Supabase 项目 URL
 *   SUPABASE_SERVICE_KEY  Supabase Service Role Key
 *   TC_SG_DATABASE_URL   腾讯云新加坡 PG 连接串
 */

import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const TABLES = ['User', 'Expert', 'Booking', 'Review']

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const tcPg = new Client({ connectionString: process.env.TC_SG_DATABASE_URL })
  await tcPg.connect()

  for (const table of TABLES) {
    console.log(`[sync] Syncing ${table}...`)
    await syncTable(table, supabase, tcPg)
  }

  await tcPg.end()
  console.log('[sync] Done.')
}

main().catch((err) => {
  console.error('[sync] Fatal error:', err)
  process.exit(1)
})
```

（完整脚本实现见 `scripts/sync-supabase-to-tc-sg.mjs`）

### 定时执行

在腾讯云新加坡服务器上配置 crontab：

```bash
# 每天凌晨 2 点执行
0 2 * * * cd /path/to/expert-network && node scripts/sync-supabase-to-tc-sg.mjs >> logs/sync.log 2>&1
```

或用 **腾讯云定时触发器（Cloud Scheduler）** 调用 HTTP 接口触发同步。

---

## 数据映射与转换

| Supabase 字段 | 腾讯云 SG 字段 | 说明 |
|---------------|-------------------|------|
| `id` (UUID)   | `id` (UUID)      | 主键值不变，保持关联 |
| `created_at`   | `created_at`      | 直接同步 |
| `updated_at`   | `updated_at`      | 用于增量同步判断 |
| 敏感字段        | 不同步            | `email`、`password_hash` 等 |

---

## 推荐实施顺序

1. **先用方案 B（ETL 脚本）** 验证数据同步逻辑（更可控，网络要求低）
2. **同步稳定后**，再尝试方案 A（逻辑复制）实现准实时同步
3. 两个方案可以并存：ETL 做全量兜底，逻辑复制做增量

---

## 文件清单

```
scripts/
  sync-supabase-to-tc-sg.mjs   ← ETL 同步脚本（本 PR 创建）

docs/design-docs/
  supabase-to-tc-sg-sync.md     ← 本文件
```

---

## 后续优化

- [ ] 增量同步（基于 `updated_at` 或 replication slot）
- [ ] 同步失败告警（企业微信机器人 / 邮件）
- [ ] 数据一致性校验（定期对比两边记录数）
- [ ] 支持软删除同步（`deleted_at` 字段）

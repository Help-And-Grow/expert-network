# WeChat CN Stack — Deploy Playbook

End-to-end automation for the mainland CN WeChat backend: build, SCF deploy, HTTP route binding, and TencentDB migrations.

> **Where to run from.** Both `cn:deploy` and `cn:migrate` are designed to run **on a Tencent Cloud Lighthouse instance in `ap-shanghai`** — not your laptop. Inside Tencent's network the COS upload finishes in seconds (vs. 10–30 min from outside China) and the Lighthouse box has 内网 access to TencentDB, so the database's 外网 access can stay disabled.
>
> Running from your laptop technically works but you'll routinely hit the COS upload timeout on `cn:deploy`, and `cn:migrate` requires opening 外网 on the DB (not recommended). See § 7 for Lighthouse setup.

## What's automated

| Step | Command | What it does |
|---|---|---|
| Deploy backend | `npm run cn:deploy` | Builds Next.js standalone, prunes macOS/build-only artifacts, deploys ~45 MB bundle to SCF via COS, binds `/*` route. |
| Migrate DB (only when schema changes) | `npm run cn:migrate` | Applies `prisma migrate deploy` to TencentDB CN over the 内网. Runs on Lighthouse. |

**Why migrations aren't bundled into the SCF**: the Prisma CLI + schema engine WASM adds ~22 MB. Pulling the CLI out keeps the deploy bundle small enough to upload reliably; schema changes are infrequent and `cn:migrate` from Lighthouse handles them out-of-band.

What's **not** automated (one-time, console-only):

| Step | Where |
|---|---|
| Provision TencentDB CN instance | Tencent CN console — see § 1 below |
| Create COS CN bucket + CAM keys | Tencent CN console |
| Get Hunyuan API key | Tencent CN console |
| Add cloudbase domain to WeChat MP allowlist | `mp.weixin.qq.com` |

---

## 0. One-time setup

```bash
cp infra/tencent-cn/.env.cn.example infra/tencent-cn/.env.cn
# Then fill in every value in .env.cn — the deploy scripts will refuse to run
# until DATABASE_URL_CN, COS keys, HUNYUAN_API_KEY etc. are populated.
```

`.env.cn` is gitignored. Treat it like `.env.local` — it holds production secrets for the CN stack.

---

## 1. Provision TencentDB CN  *(one-time, manual)*

1. Open https://console.cloud.tencent.com/postgres (Tencent **CN** site, log in with the CN account).
2. **新建 (Create Instance)**:
   - 计费模式: 包年包月 or 按量计费 (按量 is cheaper for testing).
   - 地域: **上海 (ap-shanghai)** — must match the SCF region.
   - 网络: pick the same VPC the SCF will run in (default VPC is fine for first deploy).
   - 数据库版本: PostgreSQL 14 or higher.
   - 规格: 2核4GB is plenty to start.
   - 实例名: `hg-cn-pg` (or your choice).
3. **设置密码** for the `postgres` user. Save it — you'll paste it into `.env.cn` below.
4. Once the instance is **运行中**: open it → **数据库管理** → **创建数据库** → name it `helpgrow`.
5. **网络配置**:
   - For first deploy from your laptop: **开启外网访问** and add your laptop's public IP to the whitelist.
   - For SCF runtime: ensure SCF's VPC + subnet are in the security group's allowlist (or use the default cloud-internal access if SCF is in the same VPC).
6. Copy the **内网/外网地址 + 端口 + 密码** into `infra/tencent-cn/.env.cn`:
   ```
   DATABASE_URL_CN=postgresql://postgres:<password>@<host>:<port>/helpgrow?schema=public
   ```

Once that's in place:

```bash
npm run cn:migrate
```

The script:
- tests the connection (fails loudly if the DB isn't reachable),
- runs `prisma migrate deploy` against TencentDB CN,
- prints `prisma migrate status` for confirmation.

Idempotent — re-running after the schema is up-to-date is a no-op.

---

## 2. Create COS CN bucket + CAM keys  *(one-time, manual)*

1. https://console.cloud.tencent.com/cos → **创建存储桶** in `ap-shanghai`. Name it `hg-cn-<random>`. Access: **私有读写**.
2. https://console.cloud.tencent.com/cam/capi → create a **子用户** with `QcloudCOSReadWriteOnly` policy bound to that bucket. Save `SecretId` / `SecretKey`.
3. Paste into `.env.cn`:
   ```
   TENCENT_COS_SECRET_ID=...
   TENCENT_COS_SECRET_KEY=...
   TENCENT_CN_COS_BUCKET=hg-cn-...
   ```

## 3. Get Hunyuan key  *(one-time, manual)*

1. https://console.cloud.tencent.com/hunyuan/api-key → 创建 API Key.
2. Paste into `.env.cn`:
   ```
   HUNYUAN_API_KEY=...
   ```

## 4. App secrets  *(one-time, manual)*

Copy these from the existing Vercel deploy (or whatever you use locally):
```
NEXTAUTH_SECRET=<same as Vercel>
WECHAT_APP_ID=wx09d0eb079596060d
WECHAT_APP_SECRET=<from mp.weixin.qq.com → 开发设置>
```

---

## 5. Deploy

```bash
npm run cn:deploy
```

The script:
1. `npm run build` — Next.js standalone.
2. Assembles `infra/tencent-cn/build/scf-cn/` (server.js + static + public + `scf_bootstrap`).
3. Writes a per-deploy `cloudbaserc.json` with all runtime env vars.
4. `tcb fn deploy hg-app-cn --httpFn --force` — uploads the bundle.
5. Looks up the env's default `*.tcloudbase.com` domain.
6. `tcb routes add` — binds `/*` to the SCF (idempotent).

On success it prints the WeChat CN endpoint URL. Verify with:
```bash
curl https://<env>-<id>.ap-shanghai.app.tcloudbase.com/api/health/origin
# expected: {"ok":true,"wechat":true,"region":"cn",...}
```

---

## 6. Post-deploy *(one-time, manual)*

1. **mp.weixin.qq.com** → 开发管理 → 开发设置 → 服务器域名:
   - `request合法域名`: add `https://<env>-<id>.ap-shanghai.app.tcloudbase.com`
   - `uploadFile合法域名`: add `https://hg-cn-<random>.cos.ap-shanghai.myqcloud.com`
2. From `wechat/`: `npm run upload:prod:cn` to push the new build to the WeChat MP console.
3. **Submit for review** at mp.weixin.qq.com.

---

## Troubleshooting

| Error | Likely cause | Fix |
|---|---|---|
| `Connection failed` in `cn:migrate` | TencentDB IP whitelist, or DB still 创建中 | Add laptop IP to whitelist; wait for 运行中 |
| `Cannot find module @cloudbase/...` | tcb CLI missing | Script auto-installs locally on first run |
| `Cannot find module '../build/output/log'` | CloudBase/SCF stripped Next.js build-time files from `node_modules/next/dist/build` after the local bundle passed | Re-run `npm run cn:deploy` from the latest script; it patches Next.js log imports to a bundled SCF shim and smoke-tests startup without `next/dist/build` |
| Function log still shows `Node.js v18.15.0` | The old SCF runtime/config is still serving traffic | Re-run `npm run cn:deploy` from a commit whose deploy log prints `SCF runtime: Nodejs20.19`; if CloudBase keeps the old runtime, delete/recreate the function in CloudBase and deploy again |
| `不支持的触发器类型 [web]` | tcb v3 doesn't accept HTTP triggers in fn config | Already handled — script uses `tcb routes add` |
| `路径只含字母/数字/...` | Path validation | Already handled — script uses `path: /*` with `enablePathTransmission` |
| WeChat MP "请求被拒绝" after deploy | Domain not in WeChat allowlist | See § 6 step 1 |

---

## 7. Run from a Tencent Cloud Lighthouse instance (recommended)

The deploy and migrate scripts both work best from inside Tencent's network. Lighthouse is the cheapest way to get there: ~¥24/month, can be torn down between deploys.

### 7.1 Provision Lighthouse

1. https://console.cloud.tencent.com/lighthouse → 新建实例
2. **地域**: 上海 (`ap-shanghai`) — must match the SCF + DB region
3. **镜像**: Ubuntu 22.04 LTS (or 24.04 — anything recent)
4. **套餐**: 2C 4G 60Mbps is plenty (¥24/month bandwidth-included)
5. **实例名**: `hg-deploy` (or your choice)

### 7.2 Open VPC + DB security-group access

The Lighthouse instance needs to reach **TencentDB CN** over the 内网, and TencentDB COS is reachable from any Tencent VPC.

1. Make sure Lighthouse and TencentDB are in the **same VPC** (default VPC is fine for a fresh setup)
2. TencentDB → 实例详情 → 安全组 → add an inbound rule allowing the Lighthouse instance's private IP (or the entire VPC subnet) on port 5432
3. **No 外网 toggle needed on TencentDB** — Lighthouse talks 内网

### 7.3 First-time setup on Lighthouse

```bash
ssh ubuntu@<lighthouse-ipv4>

# Node 20 (matches the Vercel runtime)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

git clone https://github.com/jlzxwt8/expert-network.git
cd expert-network
npm install
```

Then create the env file:

```bash
cp infra/tencent-cn/.env.cn.example infra/tencent-cn/.env.cn
nano infra/tencent-cn/.env.cn
```

Fill in every value — the script refuses to run with empties. **Use the 内网 endpoint for `DATABASE_URL_CN`** (the `172.x` host shown on the TencentDB instance detail page), not the 外网.

### 7.4 Authenticate the tcb CLI once

```bash
npx --prefix infra/tencent-cn tcb login
```

Opens a URL — copy it to a browser on your laptop, scan the QR with WeChat, approve. The auth token is cached under `~/.cloudbaserc.json` on the Lighthouse box and survives reboots.

### 7.5 Migrate + deploy

```bash
npm run cn:migrate   # applies any new prisma migrations over 内网 — fast
npm run cn:deploy    # builds + uploads + binds the route — 1–2 min total inside Tencent's network
```

After `cn:deploy` prints the cloudbase URL, smoke-test:

```bash
curl https://<env>-<id>.ap-shanghai.app.tcloudbase.com/api/health/origin
# expected: {"ok":true,"wechat":true,"region":"cn",...}
```

### 7.6 Subsequent deploys

After the one-time setup above, every future deploy is just three commands:

```bash
ssh ubuntu@<lighthouse-ipv4>
cd expert-network && git pull && npm install
npm run cn:deploy
```

Add `npm run cn:migrate` only when `prisma/schema.prisma` changed.

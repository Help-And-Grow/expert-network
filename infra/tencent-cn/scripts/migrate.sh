#!/usr/bin/env bash
# Apply Prisma migrations to TencentDB CN — only useful when 外网 access is
# enabled on the DB instance (so this machine can reach it directly).
#
# When 外网 is OFF (recommended for production), skip this script and use
# `npm run cn:deploy` instead — it runs `prisma migrate deploy` from inside
# the SCF, over TencentDB CN's 内网, so no public access is needed.
#
# Run from repo root: `npm run cn:migrate`
# Reads DATABASE_URL_CN from infra/tencent-cn/.env.cn (gitignored).
# Idempotent: re-running after the schema is up-to-date is a no-op.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="$REPO_ROOT/infra/tencent-cn/.env.cn"

if [ ! -f "$ENV_FILE" ]; then
  cat <<'EOF' >&2
✖ infra/tencent-cn/.env.cn not found.

  cp infra/tencent-cn/.env.cn.example infra/tencent-cn/.env.cn
  # then fill in DATABASE_URL_CN with the connection string from
  # Tencent CN console → TencentDB for PostgreSQL → <instance> → 详情
EOF
  exit 1
fi

# Read DATABASE_URL_CN via Node (not bash `source`) so values containing
# `$`, `#`, `!`, smart quotes, etc. are preserved verbatim.
DATABASE_URL_CN="$(node -e '
  const fs = require("fs");
  const content = fs.readFileSync(process.argv[1], "utf8");
  const m = content.match(/^DATABASE_URL_CN=(.*)$/m);
  if (!m) process.exit(0);
  let v = m[1].trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) ||
      (v.startsWith("'\''") && v.endsWith("'\''"))) {
    v = v.slice(1, -1);
  }
  process.stdout.write(v);
' "$ENV_FILE")"

if [ -z "${DATABASE_URL_CN:-}" ]; then
  echo "✖ DATABASE_URL_CN is empty in infra/tencent-cn/.env.cn" >&2
  exit 1
fi

cd "$REPO_ROOT"

echo "▶ Verifying schema is on PostgreSQL …"
node scripts/switch-db.mjs

echo "▶ Testing connection to TencentDB CN …"
if ! DATABASE_URL="$DATABASE_URL_CN" npx prisma db execute \
       --schema prisma/schema.prisma \
       --stdin <<< "SELECT 1;" \
       >/dev/null 2>&1; then
  cat <<'EOF' >&2
✖ Connection failed.

If your TencentDB CN instance has 外网 access disabled (recommended for
production), this script can't reach it from your laptop. Skip this and
deploy instead — `npm run cn:deploy` runs migrations from inside the SCF
over the 内网 endpoint:

  npm run cn:deploy

If you intended to migrate from this machine, check:
  - DATABASE_URL_CN matches the 外网 host shown in Tencent console
  - The instance is in 运行中 state
  - Your laptop's public IP is in the security group's allowlist on port 5432
EOF
  exit 1
fi
echo "  connection OK"

echo "▶ Applying migrations to TencentDB CN …"
DATABASE_URL="$DATABASE_URL_CN" npx prisma migrate deploy \
  --schema prisma/schema.prisma

echo "▶ Verifying migration state …"
DATABASE_URL="$DATABASE_URL_CN" npx prisma migrate status \
  --schema prisma/schema.prisma

echo "✓ TencentDB CN is up to date with prisma/schema.prisma"

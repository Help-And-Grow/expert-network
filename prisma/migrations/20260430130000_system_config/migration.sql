-- The `SystemConfig` model was added to schema.prisma when the multi-cloud
-- storage abstraction landed (commit e98f307) but no migration was ever
-- generated for it. Production has been emitting `P2021 — table
-- public.SystemConfig does not exist` warnings every time the storage
-- factory or AI provider switcher reads its keys. The lib catches the
-- error and falls back to env defaults, so it's non-fatal — but it's real
-- drift that should be repaired before another column is added on top.

CREATE TABLE IF NOT EXISTS "SystemConfig" (
  "key"       TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- Add Expert.countries to store the ISO 3166-1 alpha-2 codes a coach is
-- familiar with. JSONB so we can ergonomically read it back as a string[]
-- in app code while still letting Postgres index/filter by element when
-- needed. Nullable + no default — null means "not set yet" and is treated
-- as an empty list everywhere in app code.

ALTER TABLE "Expert"
  ADD COLUMN IF NOT EXISTS "countries" JSONB;

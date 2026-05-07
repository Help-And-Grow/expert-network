# PRD: Semantic Expert Search — Operationalization

**Status**: Proposed (2026-05-07)
**Owner**: PM (jlzxwt8)
**Companion docs**: [`semantic-expert-search.md`](semantic-expert-search.md) (the original design doc — Phases 1-4) and [`supabase-to-cloudsql-migration.md`](supabase-to-cloudsql-migration.md) (the DB this depends on).

---

## What's already live (2026-05-07)

| Component | Where | Notes |
|---|---|---|
| `expert_profile_embeddings` table + ivfflat index | Cloud SQL `helpgrow` | `vector(1536)` cosine index, ~6 rows |
| Embed-on-demand helper | `src/lib/expert-search-embeddings.ts` | `embedExpertProfile()`, `backfillExpertProfileEmbeddings()` |
| Vector pre-rank fast path | `src/app/api/experts/match/route.ts` + `src/lib/expert-match-search.ts` | Skips both LLM calls when flag is on + history is empty + vector pool returns hits |
| Feature flag | SystemConfig `EXPERT_SEARCH_VECTOR_PRERANK = "true"` | Production |
| Admin backfill route | `POST /api/admin/embeddings/backfill` | Auth-gated; admin only |

**Measured impact**: `/api/experts/match` p95 dropped from **14–25 s → 0.9–2.4 s** (~10–17× speedup). The discover chat in WeChat now feels instant.

---

## What's NOT live — the two follow-ups

The fast path stays fast as long as embeddings stay **fresh** and the vector index stays **well-tuned**. Both items are passive — *nothing breaks* if we ignore them — but quality degrades in predictable ways at known scale milestones.

This PRD captures both as separate work items so a future iteration (Codex, AI agent, or human) can pick either one up independently.

---

## Follow-up 1 — Auto-refresh embeddings when expert profiles change

### Problem

Backfill is a one-shot operation. When an expert:
- **Publishes** a profile for the first time
- **Edits** their bio / services / avatar script
- Has **new memories** written by mem9 (voice chat transcripts, etc.)

… their `expert_profile_embeddings` row stays **stale** until someone re-runs the backfill manually. Stale rows make the vector pre-rank less accurate (or, for newly-published experts, completely invisible to the fast path).

The `semantic-expert-search.md` design called for Inngest-based async refresh on three events:
- `expert.profile.published`
- `expert.profile.changed` (PATCH from `/api/expert/profile`)
- `expert.memory.indexed` (significant memory write via mem9-lifecycle)

The handlers and event-emitters were partly scaffolded (`src/lib/inngest/emit.ts` exists), but **no Inngest function is registered** to actually consume these events and run `embedExpertProfile()`.

### Goal

When an expert publishes or meaningfully edits their profile, their embedding row is refreshed within **2 minutes** (debounced) without a human triggering anything.

### Acceptance criteria

- [ ] **`expert.profile.published`** event emits from `src/app/api/onboarding/publish/route.ts`. Synchronous embed before responding (publish is rare; users expect it to land on the discover page immediately after).
- [ ] **`expert.profile.changed`** event emits from `src/app/api/expert/profile/route.ts` PATCH. Async via Inngest with **30-second debounce** so a burst of edits coalesces into one re-embed.
- [ ] **`expert.memory.indexed`** event emits from `src/lib/integrations/mem9-lifecycle.ts` after a memory write. Async via Inngest, **same 30-second debounce key as `profile.changed`** (de-duplicates if both fire near-simultaneously).
- [ ] New Inngest function `expertEmbeddingRefresh` registered at `/api/inngest`, listens to all three events, calls `embedExpertProfile(expertId)`. Idempotent — `embedExpertProfile()` already short-circuits when content_hash is unchanged.
- [ ] **Coverage widget** on `/admin` shows live coverage percentage: `count(*) WHERE embedding IS NOT NULL / count(*) WHERE isPublished = TRUE`. Below 95% is a yellow warning; below 80% is a red alert.
- [ ] **Weekly Inngest cron** that scans for rows with `embedded_at < now() - interval '30 days'` and re-embeds them, catching any drift the event-driven path missed.
- [ ] Tests: a unit test that asserts `expertEmbeddingRefresh` is called exactly once per debounce window when 3 PATCHes arrive within 30 s.

### Triggering criteria — when to actually build this

Build when **any one** of these is true:

1. **Expert pool reaches 30+ published experts** — at that scale, manual backfill becomes painful and "stale embedding" complaints (e.g. "I updated my bio yesterday but discover still uses the old text") start showing up.
2. **Onboarding velocity exceeds 1 new expert per week** — at that rate, the backfill needs to happen at least weekly, which is tedious to do by hand.
3. **A specific user complaint** about an updated profile not surfacing in discover — that's the canary.

Until at least one of those triggers fires, the manual backfill (one curl call) is fine.

### Manual fallback (until then)

```bash
curl -X POST https://www.help-and-grow.com/api/admin/embeddings/backfill \
  -H "Cookie: <admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

This re-runs `backfillExpertProfileEmbeddings({})` over all published experts. Idempotent — content-hash unchanged rows are skipped, takes < 5 s for the current pool.

### Out of scope

- **Cross-region replication of embeddings.** Once WeChat-CN's separate TencentDB stack is live, it'll need its own `expert_profile_embeddings` table populated by the daily sync (architecture.md §1 Phase 2). That's a separate effort tracked in `tencent-cloud-rollout.md`.
- **Multi-language embeddings.** Currently we embed using whatever language the bio/services are written in (typically English). Future Chinese-only profiles might benefit from a Chinese-specific embedding model — defer until we have data showing it matters.

### Estimated scope

~1 day for a coding agent (Codex Phase 1.5 in the original semantic search plan). Bulk of the work is wiring the Inngest handler — the embedding logic already exists.

---

## Follow-up 2 — Re-tune the ivfflat index at scale

### Problem

The current ivfflat index was created with `lists = 100` when the table had only 6 rows. Postgres warned at creation time:

```
NOTICE: ivfflat index created with little data
DETAIL: This will cause low recall.
```

`ivfflat` partitions vectors into `lists` clusters and only searches the closest few clusters at query time. With far fewer rows than lists, most clusters are empty, recall stays high *for now* but the index spends more memory than it needs to.

Once the table grows past ~1,000 rows, the standard tuning rule of thumb applies:

| Row count | Recommended `lists` | `probes` (query-time) |
|---|---|---|
| < 1,000 | sequential scan beats any index — drop it | — |
| 1,000 – 10,000 | `rows / 1,000` (e.g. 5,000 rows → `lists = 5`) | 1–2 |
| 10,000 – 100,000 | `sqrt(rows)` (e.g. 50,000 rows → `lists ≈ 224`) | `sqrt(lists)` (15) |
| > 100,000 | Switch to **HNSW** (`pgvector` 0.5+) for better recall/latency trade-off | — |

The current `lists = 100` is wrong at any scale — too high for < 10k rows, too low for > 100k. The right rebuild moment is after we cross ~1,000 rows.

### Goal

Maintain `recall@10 ≥ 0.95` (semantic top-10 set matches what an exact cosine sweep would return) and `p95 latency < 50 ms` for the vector lookup as the expert pool grows.

### Acceptance criteria

- [ ] **Recall measurement script** at `scripts/measure-vector-recall.ts`: picks 50 random queries from `discover` chat history, runs both ivfflat (with current params) and exact (`SET enable_indexscan = OFF`), computes overlap of top-10 sets. Outputs JSON `{ avg_recall, p95_latency_ms, lists, probes }`.
- [ ] **Tuning playbook** committed at `docs/references/pgvector-tuning.md`:
   - Table sizing thresholds (the table above)
   - Step-by-step rebuild SQL (DROP INDEX + CREATE INDEX with new `lists`)
   - Rebuild does not require downtime — concurrent index creation is supported (`CREATE INDEX CONCURRENTLY`)
- [ ] **Optional: HNSW migration path** documented for the > 100k row scenario. Not implemented unless needed.
- [ ] **Coverage widget on /admin** (added in Follow-up 1) extended to also show "vector lookup p95 latency last 24h" — a leading indicator that re-tuning is overdue.

### Triggering criteria — when to actually build this

Build when **any one** of these is true:

1. **`expert_profile_embeddings` row count crosses 1,000** — the smallest scale where ivfflat tuning starts to matter.
2. **Vector lookup p95 latency from `pg_stat_statements` exceeds 200 ms** for the discover query — index is no longer fast enough.
3. **Recall complaint** — operator notices the discover top results don't match user expectation, recall drops below 0.95.

Until then, the index works correctly (just inefficiently). No user-visible impact.

### Estimated scope

~0.5 day total — measurement script + playbook + ALTER. No code changes to the search path itself; this is pure index ops.

### Manual fallback (until then)

When you cross the threshold, on the Cloud SQL instance:

```sql
-- Pick `lists` value from the table above based on your current row count.
-- Example for 5,000 rows:
DROP INDEX CONCURRENTLY IF EXISTS idx_expert_profile_embedding_cosine;
CREATE INDEX CONCURRENTLY idx_expert_profile_embedding_cosine
  ON expert_profile_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 5);

-- And bump query-time probes via SystemConfig if needed:
-- ALTER SYSTEM SET ivfflat.probes = 2;  -- requires restart, prefer per-session SET
```

---

## Cross-cutting

### Telemetry to add (helps both follow-ups)

- Log structured JSON `[match]` line in `/api/experts/match/route.ts`:
  - `pre_rank_source` (`vector` / `keyword` / `fallback`)
  - `pre_rank_top_k` (e.g. 10)
  - `pre_rank_latency_ms` (just the embedding + cosine search)
  - `total_latency_ms`
  - `rank_source_final` (`vector` / `llm`)
- Vercel log filter on this string lets you compute fast-path hit rate, vector latency p50/p95, and recall complaints over time.

### Out of scope for this PRD

- **Reranking with a cross-encoder** (e.g. Cohere Rerank, Vertex's Discovery Engine reranker). Useful only when the LLM matchExperts step is reintroduced — currently we deterministically build the reason from the expert's own bio so a reranker has no signal to add.
- **Hybrid search** (combining vector and keyword scores). Could improve recall on rare-word queries, but the current keyword fallback path inside `matchRoute` already handles that — adding hybrid scoring is premature optimization.
- **Per-region embeddings**. CN and Intl users may eventually warrant region-specific embeddings (different language distributions), but until WeChat-CN is live, every embedding is global.

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-07 | Two follow-ups split into separate PRD items | Different triggers, different scopes — bundling them creates artificial coupling |
| 2026-05-07 | Both follow-ups are passive / no immediate work needed | Current scale (6 experts) doesn't trigger either threshold; manual backfill is acceptable |
| 2026-05-07 | Inngest is the chosen async runner | Already a dependency; same pattern used elsewhere in the codebase |

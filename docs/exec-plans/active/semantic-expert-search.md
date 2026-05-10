# Semantic Expert Search — Design Doc + Implementation Plan

**Status**: Phase 1–3 done. Phase 4 (production rollout) is operational only — backfill + flag flip + 24 h watch + manual eval. (2026-05-05)
**Owner**: TBD
**Scope**: Replace today's full-pool LLM matching with embedding-based pre-ranking + LLM rerank.
**Predecessors**: PR #29 ("kill keyword-fallback junk for specific topics") — immediate UX fix that this plan builds on.
**Reference**: [`docs/design-docs/architecture.md`](../../design-docs/architecture.md) §3 (AI Stack)

---

## 1. Background

### 1.1 Current state (post-PR #29)

`/api/experts/match` and `chat-engine.ts` use a single shared helper, `buildLLMExpertContext()` (in `src/lib/expert-match-context.ts`), to build a per-expert context block for **every** published expert in the pool. The blocks are concatenated and sent to the LLM matcher (`ai.matchExperts(query, expertSummaries, history, nq)`); the LLM picks the top 2-3 with grounded reasoning. The keyword fallback now only fires for `greeting` / `broad_exploration` intents, with a stop-word filter and a higher score threshold so it can't surface junk like "profile mentions 'familiar, with'" anymore.

### 1.2 Why this doesn't scale

| Concern | Today | At ~100 experts | At ~500 experts |
|---|---|---|---|
| Tokens per query (context + prompt) | ~5k | ~60k | ~300k |
| Per-query LLM cost (Qwen-Plus / Gemini-1.5-Flash) | ~$0.001 | ~$0.012 | ~$0.06 |
| p95 latency | 2-4 s | 6-12 s | 25 s+ (or context-window error) |
| Recall on niche queries | OK | Drops noticeably | Misses obvious matches |

The LLM has a finite attention budget. Past ~50 experts it starts missing the right one even when it's textually present in the prompt — it's the same problem as a human reading 100 résumés to find one Stripe specialist.

### 1.3 Goal

A two-stage pipeline:

1. **Embedding pre-rank** — cosine-rank a per-expert profile embedding against the query embedding, take top 8-10 candidates.
2. **LLM rerank** — pass _only_ those 8-10 to the existing matcher prompt (`buildMatchExpertsPrompt`), get back the final 2-3 with grounded reasons.

Result: O(1) LLM context size regardless of pool size, sub-100 ms pre-ranking, and the existing prompt + provider chain (Qwen→Gemini for Web/Telegram, Hunyuan for WeChat) keeps working unchanged.

---

## 2. What's already in the codebase

We are **not building from zero**. Existing scaffolding we leverage:

| Component | Where | Status |
|---|---|---|
| pgvector extension + `vector(1536)` columns | Postgres (Cloud SQL + TencentDB CN) | ✅ Enabled in `/api/admin/migrate` |
| Gemini `embedding-001` helper with `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` task types | `src/lib/integrations/pgvector-memory.ts` `fetchGeminiEmbedding()` | ✅ In production for mem9 backfill |
| `expert_memory_embeddings` table (per-memory rows, separate from this plan) | Migrate route line 73 | ✅ Live; we do **not** repurpose it |
| Per-expert profile fields (bio, avatarScript, services, social URLs, mem9 memories) | `Expert` model + `buildLLMExpertContext()` | ✅ Already in the LLM context |
| Admin backfill pattern | `/api/admin/pgvector-backfill` route | ✅ Pattern to mirror for the new table |
| Feature-flag gating | `USE_PGVECTOR_MEMORY=1` env | ✅ Add a sibling flag for this feature |
| `EXPERT_SEARCH_VECTOR_PRERANK` admin SystemConfig key | `/api/admin/system-config`, `/admin/system-config` | ✅ Default false |

Net new code is small: one new table, one indexer, one ranker. The matcher prompt, the fallback chain, the keyword backstop, and provider routing all stay as-is.

---

## 3. Architecture

```
┌────────────────────┐            ┌─────────────────────────┐
│ Discover / chat    │  query     │ /api/experts/match      │
│ (Web, Telegram,    │──────────▶ │ chat-engine.ts          │
│  WeChat MP)        │            │                         │
└────────────────────┘            │  ┌───────────────────┐  │
                                  │  │ rankBySemantic()  │──┼─▶ pgvector
                                  │  │  (NEW)            │  │   ANN search
                                  │  └─────┬─────────────┘  │   (top 8–10)
                                  │        │ expertIds      │
                                  │        ▼                │
                                  │  ┌───────────────────┐  │
                                  │  │ existing match    │  │
                                  │  │ flow              │──┼─▶ Qwen → Gemini
                                  │  │ (LLM matcher)     │  │   chain (or
                                  │  └─────┬─────────────┘  │   Hunyuan
                                  │        ▼                │   for WeChat)
                                  │  ┌───────────────────┐  │
                                  │  │ stop-word         │  │
                                  │  │ keyword fallback  │  │
                                  │  │ (greeting/broad)  │  │
                                  │  └───────────────────┘  │
                                  └─────────────────────────┘

┌────────────────────┐
│ Onboarding publish │
│ Profile edit       │   embed
│ Memory write       │──────────▶ embedExpertProfile()
│ Admin backfill     │            (NEW indexer)
│ Inngest cron       │              │
└────────────────────┘              ▼
                           UPSERT expert_profile_embeddings
                                  │
                                  ▼
                          pgvector ivfflat index
                          (cosine ops, lists=100)
```

---

## 4. Data model

### 4.1 New table: `expert_profile_embeddings`

```sql
CREATE TABLE expert_profile_embeddings (
  expert_id     TEXT        PRIMARY KEY REFERENCES "Expert"("id") ON DELETE CASCADE,
  content_hash  TEXT        NOT NULL,           -- sha256 of source text → skip re-embed if unchanged
  source        TEXT        NOT NULL,           -- the actual text we embedded (for debugging / re-embed)
  embedding     vector(1536),
  embedded_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_published  BOOLEAN     NOT NULL DEFAULT TRUE,    -- denormalised filter
  region        TEXT                                  -- "global" | "wechat-cn" | "wechat-intl"
);

CREATE INDEX idx_expert_profile_embedding_cosine
  ON expert_profile_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX idx_expert_profile_published
  ON expert_profile_embeddings(is_published)
  WHERE is_published = TRUE;
```

**One row per expert** (vs. multi-row per memory in `expert_memory_embeddings`). This is the right shape for "rank experts by relevance" — top-K candidate experts is exactly what the LLM matcher expects.

### 4.2 Why a separate table from `expert_memory_embeddings`

| Dimension | `expert_memory_embeddings` (existing) | `expert_profile_embeddings` (new) |
|---|---|---|
| Unit of indexing | One memory snippet | Whole profile |
| Cardinality | N rows per expert (10s-100s) | Exactly 1 row per expert |
| Query target | Single expert (per-expert memory recall) | All experts (cross-expert ranking) |
| Update trigger | Memory write (mem9 hook) | Profile edit / publish |
| TTL | Memories accumulate forever | Replaced on every profile change |

Repurposing the existing table would conflate two access patterns and complicate both. New table, clear semantics.

### 4.3 What text we embed (`source` column contents)

A composite "profile sentence" — same field set as `buildLLMExpertContext` but without the `ID:` / `Name:` / `Focus:` headings (embeddings care about semantic content, not field structure):

```
{Name} — {focus label}.

{Bio paragraph clamped to 600 chars}

Services: {comma-separated services}.

Intro memo (own words): {avatarScript clamped to 800 chars}

Active on: {LinkedIn, X, Substack, Instagram, Xiaohongshu — only the configured ones}.

Recent memory snippets: {top 5 memory contents joined; clamped to 600 chars}.
```

Built by a new helper `buildExpertEmbeddingText(expert, memories)` next to the existing `buildLLMExpertContext`. Length-clamped to 8000 chars (Gemini `embedding-001` input limit).

### 4.4 PDF content (deferred)

`Expert.documentData` is base64-encoded PDF content. We do **not** include it in either the LLM context (PR #29) or the embedding text. Plain-text extraction at upload time is queued as separate work — see §8 Out of Scope.

---

## 5. Indexing pipeline

### 5.1 When to embed

Five trigger points, all calling `embedExpertProfile(expertId)`:

| # | Trigger | Code path | Synchronous? |
|---|---|---|---|
| 1 | Profile **publish** | `POST /api/onboarding/publish` | yes (one expert, one call, < 1s) |
| 2 | Profile **edit** | `PATCH /api/expert/profile` | async via Inngest (debounce 30s) |
| 3 | Significant memory **write** | mem9 lifecycle `recordExpertMemory` | async via Inngest (debounce 5 min) |
| 4 | Manual **bulk reindex** | `POST /api/admin/embeddings/backfill` | async, batched |
| 5 | Stale-refresh **cron** | Inngest weekly job (rows > 30 days old) | async, batched |

Sync embed on publish; async everywhere else so user-visible writes don't pay the embedding latency.

### 5.2 Hash-based skip

```
new_hash = sha256(source_text)
if expert.embedding_row exists AND row.content_hash == new_hash:
    return  // no-op — saves API cost on idempotent calls
else:
    embedding = fetchGeminiEmbedding(source_text, RETRIEVAL_DOCUMENT)
    upsert(expert_id, content_hash, source, embedding, is_published, region)
```

Important for idempotency: an expert hitting "Save" five times in a row without changing anything should generate one embedding call, not five.

### 5.3 Failure handling

If the Gemini embedding API fails (rate limit, network blip, auth):

- Log with structured fields (`expertId`, `attempt`, `gemini_status`)
- Insert / update the row with `embedding = NULL`
- Match query treats `embedding IS NULL` rows as "not searchable via vector path" — they fall back to inclusion via the keyword path or LLM-only path

This is the same graceful-degradation pattern as `searchExpertMemoryChunks`. The discover page never breaks because of an embedding outage.

### 5.4 Region tagging

`region` is set at embed time:

| Source | Region value |
|---|---|
| Web onboarding (Vercel) | `global` |
| WeChat-CN SCF (`IS_WECHAT=true && PROXY_REGION=cn`) | `wechat-cn` |
| WeChat-Intl SCF | `wechat-intl` |

Query-side filter includes `global`/null rows, the request region, and `wechat-intl` rows for `global` surfaces. WeChat clients see Web-published experts AND their region's WeChat-published experts; Web/Telegram can see the current international WeChat stack but not future mainland-CN-only rows.

---

## 6. Query pipeline

### 6.1 New module: `src/lib/expert-match-search.ts`

```ts
export interface SemanticRankResult {
  expertIds: string[];           // ordered by relevance, top first
  source: "vector" | "fallback"; // "fallback" when pgvector / embeddings unavailable
}

export async function rankExpertsBySemanticRelevance(
  query: string,
  options: {
    region?: "global" | "wechat-cn" | "wechat-intl";
    limit?: number;              // default 10
    excludeUserId?: string;      // viewer's own profile
  },
): Promise<SemanticRankResult>;
```

Behaviour:

1. If `EXPERT_SEARCH_VECTOR_PRERANK` SystemConfig key is `false` → return `{ expertIds: [], source: "fallback" }` immediately. Caller treats `fallback` as "use full pool".
2. Embed the query with `taskType: RETRIEVAL_QUERY`.
3. If embedding fails → `fallback`.
4. Run pgvector ANN query:
   ```sql
   SELECT expert_id
   FROM expert_profile_embeddings
   WHERE is_published = TRUE
     AND embedding IS NOT NULL
     AND (
       region IS NULL
       OR region = 'global'
       OR region = $request_region
       OR ($request_region = 'global' AND region = 'wechat-intl'))
     AND ($exclude_user_id IS NULL OR expert_id NOT IN (
            SELECT id FROM "Expert" WHERE "userId" = $exclude_user_id))
   ORDER BY embedding <=> $query_embedding
   LIMIT $limit;
   ```
5. Return ordered ids.

### 6.2 Wiring into the route

```ts
// In /api/experts/match POST handler, AFTER nq is computed:

const region = isWeChatOriginatedRequest(request)
  ? (env.PROXY_REGION === "intl" ? "wechat-intl" : "wechat-cn")
  : "global";

const ranked = await rankExpertsBySemanticRelevance(nq.english, {
  region,
  limit: 10,
  excludeUserId: viewerUserId ?? undefined,
});

const experts = ranked.source === "vector"
  ? await prisma.expert.findMany({
      where: { id: { in: ranked.expertIds }, isPublished: true },
      include: { user: { select: { nickName: true, name: true } } },
    })
  : await prisma.expert.findMany({  // existing full-pool query
      where: { isPublished: true, ...(viewerUserId ? { userId: { not: viewerUserId } } : {}) },
      include: { user: { select: { nickName: true, name: true } } },
    });

// rest of route (memory hydration, buildLLMExpertContext, ai.matchExperts) UNCHANGED
```

The order of `experts` returned by Prisma when filtering on `id IN [...]` is **not** guaranteed to match the input order, so we either re-sort by `expertIds.indexOf(...)` to preserve rank, or rely on the LLM matcher to re-pick (current behaviour). Recommendation: preserve rank — even if the LLM ignores order, the prompt construction is more deterministic for evals.

### 6.3 Same wiring in `chat-engine.ts`

`chat-engine.ts` is the platform-agnostic version used by Telegram + WeChat MP `/api/chat`. Same change: replace the `prisma.expert.findMany({ where: { isPublished: true } })` line with a `rankExpertsBySemanticRelevance` call when the flag is on. Behaviour stays identical when off.

---

## 7. Implementation plan (phased, ~3 days work)

### Phase 1 — Schema + indexer (1-1.5 days)

| # | Task | File | Notes |
|---|---|---|---|
| 1.1 | Add table + indexes to `/api/admin/migrate` SQL list | `src/app/api/admin/migrate/route.ts` | ✅ Idempotent `IF NOT EXISTS` like the existing entries |
| 1.2 | New file with `embedExpertProfile()`, `buildExpertEmbeddingText()`, hash-skip logic | `src/lib/expert-search-embeddings.ts` | ✅ Mirrors `pgvector-memory.ts` shape |
| 1.3 | Wire sync embed into `/api/onboarding/publish` | `src/app/api/onboarding/publish/route.ts` | ✅ After `expert.update({ isPublished: true })` |
| 1.4 | Wire async embed into `/api/expert/profile` PATCH and mem9 lifecycle | 2 routes | ✅ Inngest event `app/expert.profile.changed` |
| 1.5 | Inngest function consuming `app/expert.profile.changed` events | `src/inngest/functions/expert-embedding-refresh.ts` | ✅ New |
| 1.6 | Backfill admin endpoint | `src/app/api/admin/embeddings/backfill/route.ts` | ✅ Mirrors the existing `pgvector-backfill` pattern |
| 1.7 | Run backfill against production after Phase 1 deploy | Manual — admin button | Verify all published experts have an embedding row |

### Phase 2 — Query pipeline + flag (0.5-1 day)

| # | Task | File | Notes |
|---|---|---|---|
| 2.1 | New file with `rankExpertsBySemanticRelevance()` | `src/lib/expert-match-search.ts` | ✅ |
| 2.2 | Wire into `/api/experts/match` BEFORE the existing flow | `src/app/api/experts/match/route.ts` | ✅ Behind flag |
| 2.3 | Same wiring in `chat-engine.ts` | `src/lib/chat-engine.ts` | ✅ Behind flag |
| 2.4 | Add `EXPERT_SEARCH_VECTOR_PRERANK` SystemConfig + admin toggle | `/admin/system-config` UI | ✅ Default `false` until backfill completes |

### Phase 3 — Operational hardening (0.5 day) — ✅ Done (2026-05-05)

| # | Task | File | Notes |
|---|---|---|---|
| 3.1 | Inngest weekly cron `expert-embeddings-refresh-stale` (rows > 30 days old) | `src/inngest/functions/expert-embedding-refresh.ts` | ✅ `expertEmbeddingRefreshStaleScheduled`, `cron("0 3 * * 0")`, registered in `/api/inngest/route.ts`, calls `refreshStaleExpertProfileEmbeddings({ olderThanDays: 30, limit: 100 })` |
| 3.2 | Admin dashboard widget showing embedding coverage | `/admin/system-config` page | ✅ Three badges: enabled/disabled, "N/M searchable", and "K stale" — driven by `getExpertProfileEmbeddingCoverage()`. Backfill button next to them. |
| 3.3 | Telemetry: structured log `[match]` with `pre_rank_top10`, `llm_final`, `query`, `rank_source` | Existing `console.log` upgrade | ✅ Both `/api/experts/match` and `chat-engine.ts` log `{ source, region, candidates, elapsedMs }` after each match |

### Phase 4 — Enable for production (~1 hour) — ⬜ Pending operator action

All code is in place. This phase is operational only:

1. **Open `/admin/system-config`** → look at the "Vector pre-rank" card. The "N/M searchable" badge tells you current coverage.
2. **Click "Backfill Embeddings"** if coverage is below ~95% of published experts. The button calls `POST /api/admin/embeddings/backfill`. Watch for the success toast.
3. **Flip the toggle** "EXPERT_SEARCH_VECTOR_PRERANK" → on. Hit "Save". 60 s SystemConfig cache TTL kicks in.
4. **Watch for 24 h** on Vercel logs:
   - `[match]` and `[chat-engine]` lines with `source: "vector"` confirm the new path is live.
   - p95 on `/api/experts/match` should drop ≥ 30% (target).
   - LLM token usage per query should drop ≥ 5× (fewer candidates in the prompt).
5. **Manual eval** (~30 min): run the same 20 reference queries before/after. Recall on niche queries should be ≥ pre-rollout.
6. **Rollback** if anything looks wrong: flip the toggle off. Reverts within 60 s. No code change, no redeploy.

---

## 8. Out of scope (future work)

| Item | Why deferred |
|---|---|
| **PDF text extraction at index time** | Need a server-side PDF→text pipeline (pdf-parse, pdf.js, or Gemini Vision). Useful when CV-heavy experts upload résumés that aren't reflected in their bio. Independent of vector search; tracking separately. |
| **Hunyuan embeddings on the WeChat path** | Today the embedding step still calls Gemini even on WeChat. That's one cross-border hop, but it's async (writes) or 1×30ms (reads). Tencent's embedding API doesn't yet support `outputDimensionality=1536` to match our existing `vector(1536)` columns; revisit when it does. |
| **HNSW index** instead of ivfflat | pgvector ≥ 0.5 supports HNSW. Better recall at the cost of slower writes. Reconsider when expert count > 5k. |
| **Query rewrite before embedding** | An LLM rewrite of `"I need someone who's done both A and B"` to a denser semantic phrase could improve recall. Premature optimisation at our pool size; the current `ai.normalizeQuery()` step already produces a clean English form. |
| **Multi-row per expert (bio + memo + per-service)** | Finer recall on niche queries at 3-5x storage. Start with one row per expert; revisit if recall is poor on niche queries during Phase 4 evaluation. |
| **Click-through / booking-rate ranking signal** | Once we have user feedback data, blend it into the rank with a learned-to-rank model. Requires building the click pipeline first. |

---

## 9. Cost + latency

| Metric | Estimate |
|---|---|
| Gemini `embedding-001` cost | $0.000025 / 1k input chars |
| Per-expert embedding (one-time + edits) | ~2k chars × $0.000025/k ≈ **$0.00005** |
| 500 experts × 1 embed/week (cron) | ~$0.025 / week — negligible |
| Per-query embedding (RETRIEVAL_QUERY) | ~50-200 chars ≈ **$0.000005** per query |
| pgvector ANN search latency (100 lists, 1k rows) | < 30 ms p99 |
| LLM matcher tokens after pre-rank (10 candidates × ~600 tokens) | ~6k vs 60k+ today — **~10x reduction** |
| Per-query end-to-end (after rollout) | embed (~80ms) + ANN (~30ms) + LLM (~1.5s) = **~1.6s p50** vs ~3-5s today |

---

## 10. Rollback plan

Three rollback levers, in increasing severity:

1. **Disable via SystemConfig**: set `EXPERT_SEARCH_VECTOR_PRERANK = false`. No redeploy. Reverts to today's full-pool flow within 60s (SystemConfig cache TTL). All other state is preserved.
2. **Truncate the embeddings table**: `DELETE FROM expert_profile_embeddings;`. The flag-off path doesn't read it, so this is a no-op for runtime; only needed if there's data corruption suspicion. Backfill rebuilds in ~30s.
3. **Drop the table + indexes**: Revert the migration. Equivalent to the day before this work landed.

---

## 11. Open questions

1. **Embed the focus label?** It's terse and high-signal; today it's part of `buildLLMExpertContext` but redundantly composed from social-platform data. Recommendation: include it — embeddings benefit from short labels alongside discursive prose.

2. **Reorder Prisma results to match `expertIds` rank?** Yes — even though the LLM matcher re-ranks freely, deterministic input order makes evals reproducible. ~5 lines of code.

3. **Embedding refresh on profile edit — sync or async?** Async via Inngest with 30 s debounce. Synchronous would add ~500 ms to the PATCH flow and offer no user-visible benefit (the user doesn't see search results in the same request).

4. **Do we precompute embeddings for unpublished experts?** No — they're not searchable, so embedding is wasted Gemini API cost. The `is_published = TRUE` guard means we only embed on publish.

5. **What about deletes?** `ON DELETE CASCADE` on the `expert_id` foreign key handles it. Unpublishing (soft-delete) flips `is_published = FALSE` on the embedding row via the same Inngest path.

---

## 12. Acceptance criteria

Phase 1 done when:
- [ ] Migration applied to all three databases (Web/Cloud SQL, WeChat-CN, WeChat-Intl)
- [ ] Backfill produces ≥ 95 % coverage of `published = TRUE` experts
- [ ] Re-publishing an expert updates the row with a new `content_hash`

Phase 2 done when:
- [ ] With flag off, behaviour is byte-identical to pre-PR (verified by snapshotting 10 sample queries)
- [ ] With flag on, 8-10 candidates are passed to the LLM matcher (verified in structured logs)
- [ ] `region` filter correctly isolates WeChat-CN published experts from web/Telegram surfaces

Phase 3 done when:
- [ ] p95 latency on `/api/experts/match` drops by ≥ 30 %
- [ ] LLM token usage per query drops by ≥ 5 ×
- [ ] Manual eval on 20 reference queries shows recall ≥ today's full-pool flow

---

## Implementation kick-off

When this plan is approved, file these issues in order:

1. `feat(search): pgvector schema + indexer for expert profile embeddings (Phase 1)`
2. `feat(search): rankExpertsBySemanticRelevance + flag-gated wiring (Phase 2)`
3. `chore(search): operational hardening — cron, telemetry, admin dashboard (Phase 3)`
4. `chore(search): production rollout — backfill + flag flip (Phase 4)`

Each PR targets ~1 day of work with the file list above, behind the SystemConfig flag so they ship safely without coordination.

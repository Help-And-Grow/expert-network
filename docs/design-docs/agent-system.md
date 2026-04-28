# Agent System (HiClaw)

**Status**: Accepted (phased)
**Date**: 2026-04
**Scope**: HiClaw shadow service — generator/evaluator harness, context resets, sprint contracts. Companion: [architecture.md](architecture.md), [product-features.md](product-features.md) (capability fabric).

Help & Grow delegates expert proxy interactions (vetting, follow-up, coaching) to a multi-agent service called HiClaw. This document captures the harness design that prevents agent degradation on long-running, subjective tasks.

The service runs as a **separate Node process** (`hiclaw/service/`, Express). Next.js routes call it via HTTP and read the same Postgres tables for on-chain sync and reputation.

---

## 1. Status (verification)

| Area | Status | Implementation |
|------|--------|----------------|
| Context reset + handoff artifact | **Implemented** | `hiclaw/service/src/shadowWorker.js`, `manager.js`, `store.js`; columns `handoff_artifact`, `conversation_messages`, `mem9_profile_summary`; `POST /query continueSessionId` |
| Evaluator + grading loop | **Implemented** | `evaluatorWorker.js`, `manager.js`; table `evaluator_critiques`; env `EVALUATOR_*` |
| Gate before player channels | **Implemented (service boundary)** | Draft is evaluator-graded **before** `waiting_room` enqueue; Telegram/WeChat sends still happen post-expert-approval in app layer |
| Sprint / vetting contracts | **Implemented (phased)** | Optional `sprintContract` / `autoSprintContract` + `sprintMode`; `plannerWorker.js` |
| Evaluator tools (MCP availability hint) | **Partial** | Optional `HICLAW_EVALUATOR_TOOL_URL` injection; no in-repo MCP caller yet |
| Postgres-only store | **Implemented** | `HICLAW_POSTGRES_URL` or fallback to `DATABASE_URL` via `pg`; `hiclaw/schema-postgres.sql` |

---

## 2. Why a Harness

The platform asks LLMs to act as a human expert's proxy in subjective work — vetting a founder, writing a follow-up note, coaching a long-running engagement. Two failure modes break the illusion of a premium expert network:

- **Context degradation** — the Anthropic harness research documents "context anxiety": as the window fills, models hastily wrap up tasks or hallucinate. In-place compaction (summarizing chat history) is insufficient for multi-week vetting or multi-year coaching threads.
- **Self-grading collapse** — generators are systematically bad at evaluating their own subjective output. They overly praise, output bland generic "AI slop," and hide their own failure modes.

The harness directly addresses both.

---

## 3. The Five Practices

### 3.1 Context Resets & State Handoffs

`shadowWorker` estimates prompt tokens. When tokens exceed `SHADOW_CONTEXT_RESET_RATIO × SHADOW_CONTEXT_WINDOW_TOKENS` (default 70% × 32k), the worker:

1. Generates a JSON **Handoff Artifact** — goal, progress, temperament, next step, risks.
2. Persists it to `sessions.handoff_artifact`.
3. Replaces `conversation_messages` with a rehydrated short turn list.
4. Folds the mem9 profile summary back into the system prompt.

The next turn re-instantiates the agent on a clean slate: persona prompt + handoff artifact only.

### 3.2 Decoupled Generator / Evaluator

`evaluatorWorker.js` scores each draft on brand voice, actionability, empathy, and overall (JSON-parsed). `manager` runs up to `EVALUATOR_MAX_ROUNDS` refinement rounds via `shadowWorker.refineDraft`. Critiques are persisted in the `evaluator_critiques` table for downstream prompt tuning.

The evaluator gates **before** `waiting_room` enqueue, so drafts that don't meet the bar never reach human-expert review and never reach the player.

The Generator is never asked to grade itself on subjective traits — that path is closed by code, not policy.

### 3.3 Sprint Contracts

For complex work (vetting, multi-step coaching), wandering chats are the failure mode. Callers pass `sprintContract` on `POST /query`, or set `autoSprintContract: true` with `sprintMode: vetting | coaching`. `plannerWorker` then drafts bullet-point success criteria. Both shadow and evaluator prompts include the contract verbatim.

### 3.4 Evaluator Tools (MCP availability)

Optional: `HICLAW_EVALUATOR_TOOL_URL` is a webhook the evaluator can POST `{ draft }` to and receive `{ hint }` back. Useful for slot-availability checks ("is this meetup window even bookable?") so the evaluator catches contradictions the model can't infer alone. The repo doesn't ship a first-party MCP caller yet — current hosting is product-side.

### 3.5 Postgres-Only Storage

All HiClaw state lives in standard PostgreSQL — no DB9, no TiDB, no MySQL. Tables: `expert_status`, `sessions`, `waiting_room`, `evaluator_critiques`, optional `expert_memory_embeddings` (pgvector). Schema in `hiclaw/schema-postgres.sql`.

The Next.js side reads the same tables via `src/lib/tidb.ts` (filename historical). Routes: `/api/webhook/onchain`, `/api/reputation/:expertId`, admin at `/admin/tidb`.

---

## 4. HTTP Surface

`POST /query` body (JSON):

- **Required**: `menteeId`, `expertId`, `query`
- **Optional**: `mem9SpaceId`, `expertName`, `continueSessionId` (resume same mentee + expert), `sprintContract`, `autoSprintContract` + `sprintMode`

Flow:
1. mem9 context → optional sprint contract
2. shadow generate → optional context reset + handoff persist
3. evaluator loop (scores → `evaluator_critiques`)
4. enqueue `waiting_room`
5. Expert approves via `POST /review/:draftId`

Online-expert queries are **forwarded** without generation; offline experts go through the full pipeline. Player-facing Telegram/WeChat sends fire **after** expert approval — the evaluator gates the draft before it can ever reach the queue.

---

## 5. Configuration

| Variable | Purpose |
|----------|---------|
| `HICLAW_POSTGRES_URL` | Optional dedicated Postgres URL for HiClaw |
| `DATABASE_URL` | Shared marketplace Postgres (fallback when `HICLAW_POSTGRES_URL` is unset) |
| `DASHSCOPE_API_KEY` | Qwen-Max (current default for shadow generation) |
| `MEM9_ENABLED` | Toggle mem9 profile summary injection |
| `EVALUATOR_ENABLED`, `EVALUATOR_MIN_SCORE`, `EVALUATOR_MAX_ROUNDS` | Evaluator loop tuning |
| `SHADOW_CONTEXT_WINDOW_TOKENS`, `SHADOW_CONTEXT_RESET_RATIO` | Context-reset threshold |
| `HICLAW_EVALUATOR_TOOL_URL` | Optional MCP-hint webhook |

Compose: `hiclaw/docker-compose.yml`. README: [`hiclaw/README.md`](../../hiclaw/README.md).

---

## 6. Open follow-ups

1. First-party evaluator tool that calls `/api/mcp` for slot verification (currently external-only).
2. End-user "negotiation" UX for sprint contracts (today the contract is server-drafted, not user-confirmed).
3. Decommission the historical `tidb.ts` filename — pure Postgres, no TiDB anywhere.

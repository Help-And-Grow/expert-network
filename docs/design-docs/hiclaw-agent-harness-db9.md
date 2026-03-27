# Applying Anthropic's Harness Design to Help & Grow

## Status (verification)

| Area | Status | Implemented in |
|------|--------|----------------|
| Context reset + handoff artifact on `sessions` | **Implemented** (2026-03) | `hiclaw/service/src/shadowWorker.js`, `manager.js`, `store.js`; columns `handoff_artifact`, `conversation_messages`, `mem9_profile_summary`; `POST /query` `continueSessionId` |
| Evaluator + grading loop | **Implemented** | `evaluatorWorker.js`, `manager.js`; table `evaluator_critiques`; env `EVALUATOR_*` |
| Gate before mentee channels | **Implemented (service boundary)** | Draft is evaluated before `waiting_room` enqueue; Telegram/WeChat sends remain post–expert approval in app layer |
| Sprint / vetting contracts | **Implemented (phased)** | Optional `sprintContract` / `autoSprintContract` + `sprintMode`; `plannerWorker.js` |
| Evaluator tools (e.g. MCP availability) | **Partial** | Optional `HICLAW_EVALUATOR_TOOL_URL` hint injection in `evaluatorWorker.js`; no in-repo MCP caller yet |
| HiClaw store on Postgres / DB9 | **Implemented (driver)** | `HICLAW_POSTGRES_URL` / `DB9_DATABASE_URL` + `pg`; `hiclaw/schema-postgres.sql` |
| DB9 HTTP SQL API only (stateless) | **Implemented (optional)** | When `DB9_HTTP_SQL_URL` + `DB9_HTTP_SQL_TOKEN` are set, `hiclaw/service/src/store.js` uses HTTPS instead of `pg` |

## Overview
The [recent Anthropic engineering article](https://www.anthropic.com/engineering/harness-design-long-running-apps) discusses building a "harness design for long-running application development." It specifically looks at effective multi-agent patterns, combating LLM context degradation, and objectively grading subjective AI outputs.

**Help & Grow** is an "AI Native Expert Network" where experts brand their skills as discrete services (e.g., marketing, headhunting) delivered to startup founders (learners) after an initial meeting. The expert's knowledge evolves through practice, and they continuously write reflections and best practices to their digital avatar. 

The Anthropic principles map cleanly to this product paradigm. The digital avatar acts in a dual capacity: 
- **Externally** as a proxy connecting with founders (handling Q&A, vetting, and facilitating the booking).
- **Internally** as a mentor, coach, and partner to the human expert, encouraging them and synthesizing their evolving experience into better services.

---

## 1. Context Resets & State Handoffs in HiClaw Sessions
**The Article:** Models suffer from "context anxiety" (wrapping up prematurely) and degradation when context windows fill. Relying strictly on "in-place compaction" (summarizing chat history) fails for complex work. The solution is **context resets**: closing the session, explicitly writing the state to a structured handoff artifact, and passing it to a fresh agent instance with a clean slate.

**Help & Grow Application:**
You currently use **TiDB Cloud Zero** to store HiClaw session state. As the digital avatar engages in prolonged relationships—either nurturing potential learners (founders) over weeks before a booking, or acting as an ongoing, multi-year reflection coach to the human expert—context windows will inevitably degrade.
* **Implementation (done):**
  * `shadowWorker` estimates prompt tokens; above `SHADOW_CONTEXT_RESET_RATIO` × `SHADOW_CONTEXT_WINDOW_TOKENS` (~70% × 32k default), it generates a JSON **Session Handoff Artifact** (goal, progress, temperament, next step, risks).
  * Persisted on **`sessions.handoff_artifact`**; **`conversation_messages`** replaced with the rehydrated turn list via `manager` → `store.updateSession`. mem9 **profile summary** stored on session and folded into the system prompt.

## 2. Decoupling the Generator and Evaluator
**The Article:** The Generator (the agent actually doing the work) is inherently terrible at grading itself—especially for subjective tasks. Splitting roles between a **Generator** and a strictly-prompted, skeptical **Evaluator** forces higher-quality, distinctive outputs via multi-round iteration loops.

**Help & Grow Application:**
In Help & Grow, you are dealing with subjective "soft skills" output—e.g., tone of voice, empathy, domain expertise accuracy. If an AI expert (Generator) replies on behalf of a human expert, standard generation risks sounding like "bland AI slop," fundamentally breaking the illusion of a premium, personalized expert network.
* **Implementation (done):**
  * **`evaluatorWorker.js`** scores drafts (brand voice, actionability, empathy, overall) with JSON parsing; **`manager`** runs up to `EVALUATOR_MAX_ROUNDS` refinements via **`shadowWorker.refineDraft`**.
  * Critiques persisted in **`evaluator_critiques`** for downstream prompt tuning.
  * Product path: mentee-facing Telegram/WeChat typically fire **after** expert approval of the waiting-room draft; the evaluator still gates **before** enqueue so drafts never enter the queue unreviewed by the second model.

## 3. Sprint Contracts & Planning
**The Article:** For complex generation, the "Planner" agent creates a specification, but before execution, the Generator and Evaluator negotiate a "sprint contract"—agreeing exactly on what success looks like for that step.

**Help & Grow Application:**
The digital avatar plays a complex, dual role: vetting founders on behalf of the expert, and acting as a sounding board/coach to the expert. Both workflows require strict execution bounds rather than wandering chats.
* **Implementation (phased):**
  * Callers may pass **`sprintContract`** on `POST /query`, or set **`autoSprintContract: true`** with **`sprintMode`** `vetting` \| `coaching` so **`plannerWorker`** proposes bullet-point success criteria; text is injected into shadow + evaluator prompts. Full “negotiation” UX with the end user is still product-dependent.

## 4. Harnessing Tools & Advanced Modalities
**The Article:** Empowering agents with tools native to the ecosystem (like the Playwright MCP) allows the Evaluator to physically "use" what the Generator built, creating concrete feedback loops.

**Help & Grow Application:**
You already expose Expert search, matches, and availability as MCP tools (`/api/mcp`).
* **Implementation (partial):**
  * **`HICLAW_EVALUATOR_TOOL_URL`**: POST JSON `{ draft }`; response `{ hint }` is appended to evaluator context (your service can wrap `/api/mcp` or DB checks).
  * **`evaluator_critiques`** table stores scores + critique text for analysis (works with MySQL or Postgres store).

## 5. Migrating from TiDB to DB9 for Agent Storage
**Current State:** HiClaw session data uses TiDB Cloud Zero (MySQL). However, TiDB Cloud Zero requires a manual, interactive browser "claim" step to prevent the database from expiring after 30 days. It also introduces a split stack (MySQL for HiClaw, Postgres/Supabase for core).

**DB9 Evaluation for Agent Interaction:**
Based on the [db9.ai API and feature set](https://db9.ai/skill.md), DB9 is significantly better optimized for multi-agent systems than TiDB:
1. **Fully Autonomous Provisioning:** Agents can programmatically provision, branch (`POST /customer/databases/{id}/branch`), and tear down databases using the DB9 REST API without any human-in-the-loop "claim" steps.
2. **HTTP SQL API:** Agents often struggle to manage stateful TCP database connection pools. DB9 provides a native REST API (`POST /customer/databases/{id}/sql`) allowing agents to query and mutate data completely statelessly via HTTP.
3. **Agent-Native Extensions:** DB9 comes with `pgvector` (crucial for powering the `mem9` memory spaces natively), `fs9` (allowing agents to query CSV/JSONL files or read/write local files directly from SQL), and `pg_cron` for autonomous background tasks.
4. **PostgreSQL Compatibility:** Migrating HiClaw to DB9 aligns the entire Help & Grow stack on PostgreSQL (matching the primary Supabase DB), reducing the cognitive load on coding agents and allowing shared Prisma schemas.

* **Implementation (done for Postgres URL + optional HTTP):**
  * **`store.js`** uses **`pg`** when a Postgres URL is set, or **HTTP SQL** when `DB9_HTTP_SQL_URL` + `DB9_HTTP_SQL_TOKEN` are set (body shape is best-effort: `query`/`sql` + `params`/`arguments`).
  * **`hiclaw/schema-postgres.sql`** for greenfield Postgres/DB9 (includes optional `expert_memory_embeddings` + `vector`).

---

## Action Plan Summary (historical)

The following were the original execution items; status as of 2026-03:

1. **`evaluatorWorker`** — Done (`hiclaw/service/src/evaluatorWorker.js`).
2. **Grading loop** — Done in `manager.js`; mentee notifications remain downstream of expert approval; evaluator gates the draft before `waiting_room`.
3. **Context resets + handoff schema** — Done (`sessions` columns, `shadowWorker`, `continueSessionId`).
4. **Postgres / DB9 for HiClaw store** — Done via `pg` + env selection; optional **DB9 HTTP-only** client still open.

**Follow-ups:** Wire DB9 REST SQL from agents if you want pool-free operation; add a first-party evaluator tool that calls `/api/mcp` for slot verification.

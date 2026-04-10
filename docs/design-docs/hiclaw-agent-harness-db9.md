# Applying Anthropic's Harness Design to Help & Grow

> Historical filename note: this document originally compared DB9 and TiDB for the HiClaw store.
> The runtime architecture is now PostgreSQL-only. Use `HICLAW_POSTGRES_URL` or reuse
> `DATABASE_URL`. Any DB9-specific wording below should be read as historical context, not
> current setup guidance.

## Status (verification)

| Area | Status | Implemented in |
|------|--------|----------------|
| Context reset + handoff artifact on `sessions` | **Implemented** (2026-03) | `hiclaw/service/src/shadowWorker.js`, `manager.js`, `store.js`; columns `handoff_artifact`, `conversation_messages`, `mem9_profile_summary`; `POST /query` `continueSessionId` |
| Evaluator + grading loop | **Implemented** | `evaluatorWorker.js`, `manager.js`; table `evaluator_critiques`; env `EVALUATOR_*` |
| Gate before player channels (`menteeId` in API) | **Implemented (service boundary)** | Draft is evaluated before `waiting_room` enqueue; Telegram/WeChat sends remain post–expert approval in app layer |
| Sprint / vetting contracts | **Implemented (phased)** | Optional `sprintContract` / `autoSprintContract` + `sprintMode`; `plannerWorker.js` |
| Evaluator tools (e.g. MCP availability) | **Partial** | Optional `HICLAW_EVALUATOR_TOOL_URL` hint injection in `evaluatorWorker.js`; no in-repo MCP caller yet |
| HiClaw store on Postgres | **Implemented** | `HICLAW_POSTGRES_URL` or `DATABASE_URL` + `pg`; `hiclaw/schema-postgres.sql` |

## Overview
The [recent Anthropic engineering article](https://www.anthropic.com/engineering/harness-design-long-running-apps) discusses building a "harness design for long-running application development." It specifically looks at effective multi-agent patterns, combating LLM context degradation, and objectively grading subjective AI outputs.

**Help & Grow** is an "AI Native Expert Network" where experts brand their skills as discrete services (e.g., marketing, headhunting) delivered to startup founders (**players**) after an initial meeting—**sharing** judgment, not lecturing. The expert's knowledge evolves through practice, and they continuously write reflections and best practices to their digital avatar. 

The Anthropic principles map cleanly to this product paradigm. The digital avatar acts in a dual capacity: 
- **Externally** as a proxy connecting with founders (handling Q&A, vetting, and facilitating **meetups**).
- **Internally** as a **coach** and partner to the human expert, encouraging them and synthesizing their evolving experience into better services.

---

## 1. Context Resets & State Handoffs in HiClaw Sessions
**The Article:** Models suffer from "context anxiety" (wrapping up prematurely) and degradation when context windows fill. Relying strictly on "in-place compaction" (summarizing chat history) fails for complex work. The solution is **context resets**: closing the session, explicitly writing the state to a structured handoff artifact, and passing it to a fresh agent instance with a clean slate.

**Help & Grow Application:**
HiClaw session state now lives on PostgreSQL, aligned with the rest of the product stack. As the digital avatar engages in prolonged relationships—either nurturing potential **players** (founders) over weeks before a **meetup**, or acting as an ongoing, multi-year reflection coach to the human expert—context windows will inevitably degrade.
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
  * Product path: player-facing Telegram/WeChat typically fire **after** expert approval of the waiting-room draft; the evaluator still gates **before** enqueue so drafts never enter the queue without an evaluator pass from the second model.

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
  * **`evaluator_critiques`** table stores scores + critique text for analysis.

## 5. Standardizing on Postgres for Agent Storage

HiClaw now uses standard PostgreSQL for session state, waiting-room drafts, evaluator traces, and optional pgvector tables.

* **Current implementation:**
  * **`hiclaw/service/src/store.js`** uses **`pg`** with **`HICLAW_POSTGRES_URL`** or falls back to **`DATABASE_URL`**.
  * **`hiclaw/schema-postgres.sql`** contains the shared HiClaw schema, including optional `expert_memory_embeddings` + `vector`.
  * **`/api/webhook/onchain`** and **`/api/reputation/:expertId`** read the same logical Postgres store through shared helpers.

---

## Action Plan Summary (historical)

The following were the original execution items; status as of 2026-03:

1. **`evaluatorWorker`** — Done (`hiclaw/service/src/evaluatorWorker.js`).
2. **Grading loop** — Done in `manager.js`; player notifications remain downstream of expert approval; evaluator gates the draft before `waiting_room`.
3. **Context resets + handoff schema** — Done (`sessions` columns, `shadowWorker`, `continueSessionId`).
4. **Postgres for HiClaw store** — Done via `pg` + env selection.

**Follow-ups:** Add a first-party evaluator tool that calls `/api/mcp` for slot verification and keep schema/application docs aligned as HiClaw expands.

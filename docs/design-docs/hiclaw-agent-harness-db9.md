# Applying Anthropic's Harness Design to Help & Grow

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
* **Next Step (Implementation Details):**
  * Update the `manager` in HiClaw to forcefully trigger a context reset once the `shadowWorker` prompt size breaches 70% of the context window.
  * Before the reset, prompt the active `shadowWorker` to generate a structured "Session Handoff Artifact" detailing the overarching goal, progress so far, user temperament, and the agreed-upon next step.
  * Save this artifact to TiDB Cloud (`sessions` table), clear the model’s active message history, and rehydrate a new `shadowWorker` initialized with *only* the new status report and the `mem9` profile summary.

## 2. Decoupling the Generator and Evaluator
**The Article:** The Generator (the agent actually doing the work) is inherently terrible at grading itself—especially for subjective tasks. Splitting roles between a **Generator** and a strictly-prompted, skeptical **Evaluator** forces higher-quality, distinctive outputs via multi-round iteration loops.

**Help & Grow Application:**
In Help & Grow, you are dealing with subjective "soft skills" output—e.g., tone of voice, empathy, domain expertise accuracy. If an AI expert (Generator) replies on behalf of a human expert, standard generation risks sounding like "bland AI slop," fundamentally breaking the illusion of a premium, personalized expert network.
* **Next Step (Implementation Details):**
  * Introduce an `evaluatorWorker` into the HiClaw OS alongside the existing `shadowWorker`.
  * Before a message or advice is dispatched to the Mentee via Telegram/WeChat, the `shadowWorker` submits a draft to the `evaluatorWorker`.
  * The `evaluatorWorker` is heavily prompted with **objective criteria for subjective quality**, e.g.:
    * *Brand Voice:* Does this reflect the specific expert's tone (pulled from `mem9`) or does it sound like a generic assistant?
    * *Actionability:* Is the advice practical and grounded, or abstract fluff?
    * *Empathy:* Does the response correctly index the mentee's anxiety level?
  * The Evaluator scores the draft. If it fails the threshold, it sends a critique back to the Generator to pivot or refine before it reaches the user.

## 3. Sprint Contracts & Planning
**The Article:** For complex generation, the "Planner" agent creates a specification, but before execution, the Generator and Evaluator negotiate a "sprint contract"—agreeing exactly on what success looks like for that step.

**Help & Grow Application:**
The digital avatar plays a complex, dual role: vetting founders on behalf of the expert, and acting as a sounding board/coach to the expert. Both workflows require strict execution bounds rather than wandering chats.
* **Next Step (Implementation Details):**
  * **For External Vetting:** When a founder inquires about a service, the avatar (Generator) and Evaluator negotiate a "Vetting Contract" based on the expert's `mem9` profile (e.g., "Success means answering the founder's initial 3 questions and collecting their startup's current ARR before finalizing the meeting").
  * **For Internal Coaching:** When the expert logs a reflection, the `plannerWorker` defines a coaching goal based on the expert's past progress (e.g., "Help the expert productize this new marketing tactic into a repeatable service offering"). The avatar negotiates with the expert on what the immediate output of the current coaching session should be, ensuring focused growth.

## 4. Harnessing Tools & Advanced Modalities
**The Article:** Empowering agents with tools native to the ecosystem (like the Playwright MCP) allows the Evaluator to physically "use" what the Generator built, creating concrete feedback loops.

**Help & Grow Application:**
You already expose Expert search, matches, and availability as MCP tools (`/api/mcp`).
* **Next Step (Implementation Details):**
  * Give the `evaluatorWorker` tools to simulate or trace system state. For example, if a `shadowWorker` suggests a booking slot to a user, the Evaluator can use the MCP availability tool to verify that the proposed slot is *actually* free in the database before the message is sent contextually.
  * Use the TiDB database to store the feedback loops, building a historical dataset of "Evaluator Critiques" to fine-tune the human-expert matching prompt over time.

## 5. Migrating from TiDB to DB9 for Agent Storage
**Current State:** HiClaw session data uses TiDB Cloud Zero (MySQL). However, TiDB Cloud Zero requires a manual, interactive browser "claim" step to prevent the database from expiring after 30 days. It also introduces a split stack (MySQL for HiClaw, Postgres/Supabase for core).

**DB9 Evaluation for Agent Interaction:**
Based on the [db9.ai API and feature set](https://db9.ai/skill.md), DB9 is significantly better optimized for multi-agent systems than TiDB:
1. **Fully Autonomous Provisioning:** Agents can programmatically provision, branch (`POST /customer/databases/{id}/branch`), and tear down databases using the DB9 REST API without any human-in-the-loop "claim" steps.
2. **HTTP SQL API:** Agents often struggle to manage stateful TCP database connection pools. DB9 provides a native REST API (`POST /customer/databases/{id}/sql`) allowing agents to query and mutate data completely statelessly via HTTP.
3. **Agent-Native Extensions:** DB9 comes with `pgvector` (crucial for powering the `mem9` memory spaces natively), `fs9` (allowing agents to query CSV/JSONL files or read/write local files directly from SQL), and `pg_cron` for autonomous background tasks.
4. **PostgreSQL Compatibility:** Migrating HiClaw to DB9 aligns the entire Help & Grow stack on PostgreSQL (matching the primary Supabase DB), reducing the cognitive load on coding agents and allowing shared Prisma schemas.

* **Next Step (Implementation Details):**
  * Replace the TiDB MySQL adapter in HiClaw with DB9.
  * Update HiClaw worker agents to use the DB9 HTTP API for session state interactions rather than thick clients.

---

## Action Plan Summary
To execute on this architecture change, the immediate next steps are:
1. **Define the `evaluatorWorker`:** Create a new worker module in `/hiclaw/service/src/` dedicated entirely to critiquing `shadowWorker` outputs against `mem9` expert personas.
2. **Setup the Grading Loop:** Intercept outgoing Telegram/WeChat notifications in the service layer to pause until the `evaluatorWorker` approves the response quality.
3. **Implement Context Resets:** Modify the database schema to store "Handoff Artifacts" for active sessions, replacing naive chat history arrays with synthesized state objects.
4. **Migrate HiClaw Database to DB9:** Transition the HiClaw session store from TiDB to DB9 to fully automate workspace provisioning and unify the platform on PostgreSQL.

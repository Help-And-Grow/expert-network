# Agentic System Design & Best Practices

Help & Grow delegates critical human proxy interactions (expert booking, vetting, and continuous coaching) to a multi-agent OS (HiClaw). To prevent "agent degradation" and ensure high-quality subjective output, our architecture implements the following best practices derived from Anthropic's Harness Design.

## 1. Context Resets & State Handoffs
**The Problem:** LLMs suffer from "context anxiety" when their context windows fill up—they begin hastily wrapping up tasks or hallucinating. Simply summarizing the chat history ("in-place compaction") is insufficient for complex, multi-day interactions (like vetting a founder).

**The Practice:**
*   **Force Resets:** Agents must not run indefinitely. Set a strict token threshold (e.g., 70% of context window).
*   **State Artifacts:** Before hitting the limit, force the active worker to generate a structured "Handoff Artifact" (YAML/JSON) that contains:
    1. The overarching goal
    2. Progress made so far
    3. The exact next step to execute
*   **Clean Slate:** Clear the conversation history. Re-instantiate the agent exclusively with the Persona Prompt (`mem9`) + the newly generated Handoff Artifact.

## 2. Decoupling Generation from Evaluation (The `evaluatorWorker`)
**The Problem:** The "Generator" (e.g., `shadowWorker`) is incapable of grading its own subjective output. If asked to evaluate its own empathy or tone adherence, it will reliably overly-praise itself and output bland, generic "AI slop."

**The Practice:**
*   **Strict Separation:** Never let the Generator self-grade subjective tasks. 
*   **The Skeptical Evaluator:** Implement an isolated `evaluatorWorker` that receives the drafted response. 
*   **Objective Grading for Subjective Traits:** Prompt the Evaluator not to answer "is this good?", but to grade against strict rubrics:
    *   *Tone:* "Does this match the specific expert's voice described in `mem9`?"
    *   *Actionability:* "Does this ask a concrete question, or is it generic fluff?"
*   **Rejection Loops:** The outgoing message is blocked until the Evaluator approves it. If rejected, the Evaluator generates a pointed critique to force the Generator to rewrite.

## 3. Sprint Contracts & Negotiation
**The Problem:** Vetting founders or coaching experts requires structured discipline. If left open-ended, the LLM chat wanders off-topic.

**The Practice:**
*   **Define "Done":** Before executing a task, the overarching Planner must dictate a specific milestone. Then, the Generator and Evaluator negotiate a "Sprint Contract" (e.g., "Success means we successfully extracted the founder's ARR and pain points").
*   **Strict Execution:** The agent loop is solely dedicated to fulfilling that specific contract. Only once the Evaluator confirms the contract is fulfilled do we move to the next phase.

## 4. Agent-Native Database Tooling (DB9)
**The Problem:** Managing stateful TCP connection pools inside serverless/stateless agent loops introduces massive latency, reliability issues, and complex orchestration code.

**The Practice:**
*   **Stateless Execution:** Agents should interact with core memory via direct REST APIs (e.g., DB9's HTTP SQL `POST /customer/databases/{id}/sql`).
*   **Native Vector & File Support:** Rely on `pgvector`, `fs9` (filesystem access in SQL), and `pg_cron` natively within the DB layer to handle heavy data lifting, rather than writing brittle python/node wrappers to move data back and forth to the AI context layer.

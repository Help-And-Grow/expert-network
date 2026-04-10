# Pluggable Expert Avatar Control Plane

**Status**: Accepted (phased)  
**Date**: 2026-04

## Context

Help & Grow is moving from a single-provider “AI chat” posture toward a configurable expert service system:

- Web, Telegram, and WeChat should expose a consistent expert-led experience.
- Local and on-prem deployments must stay viable with Docker + Ollama + Postgres/pgvector as the baseline.
- Cloud vendor cooperation should remain flexible: Alibaba-oriented stacks may prefer HiClaw; Google-oriented stacks may prefer Scion.
- Different experts will need different operating profiles for cost, transparency, latency, and orchestration style.

The platform therefore needs a vendor-neutral control plane instead of hard-wiring one model stack or one multi-agent framework into every capability.

## Decision

The system will use a five-layer control-plane model:

1. **Experience surfaces**  
   Web, Telegram, WeChat, MCP, and future operator/admin surfaces.
2. **Service control plane**  
   Tenant/expert configuration, entitlement, routing policy, rollout flags, and observability.
3. **Capability fabric**  
   Named product capabilities such as voice reply, realtime talk, meeting capture, memo/reflection, social learning, service matching, and conversion support.
4. **Orchestration adapters**  
   Pluggable adapters for HiClaw, Scion, and local fallback execution.
5. **Runtime/context infrastructure**  
   Models, tools, storage, memory, embeddings, queues, and container runtimes.

The capability fabric is the primary abstraction. Experience surfaces do not directly bind to HiClaw or Scion. They ask for a capability, and the control plane resolves the adapter/runtime stack.

## Capability Contract

Each capability is resolved using four selectors:

- **`orchestrator`**: `hiclaw | scion | local`
- **`runtimeProfile`**: container shape, concurrency, timeout, region, isolation level
- **`modelProfile`**: model family, provider, fallback chain, response target
- **`memoryProfile`**: `mem9 | pgvector | hybrid`, plus retrieval mode and write policy

Default precedence:

1. Platform default
2. Expert override
3. Capability override

This keeps the platform operable with sane defaults while still allowing per-expert service composition.

## Adapter Positioning

### HiClaw

Use when the workflow benefits from explicit collaboration and human visibility:

- meeting management and follow-up loops
- memo and reflection capture
- expert growth workflows
- transparent multi-step coordination where human-in-the-loop **approval** matters

### Scion

Use when the workflow benefits from more isolated and infrastructure-friendly execution:

- swarm-style agent tasks
- tool-isolated concurrent jobs
- container-oriented agent workers
- cloud-native orchestration with stronger runtime separation

### Local fallback

Always keep a local fallback for development and on-prem delivery:

- Docker Compose
- Ollama-backed LLM + embeddings
- Postgres/Supabase-compatible schema
- pgvector memory
- mem9 optional, never required

## Local and Production Runtime Shape

### Local / on-prem default

- `docker-compose.local.yml`
- Postgres + pgvector
- Ollama for text and embeddings
- Next.js API
- HiClaw sidecar as the first local orchestration target
- Scion-compatible adapter kept as a documented future path, not a blocker for local iteration

### Production targets

- Alibaba container services for HiClaw-heavy deployments
- Google container services for Scion-heavy deployments
- Same experience-layer contracts regardless of cloud runtime

The surface APIs must not embed vendor-specific semantics. Vendor specifics belong inside adapter implementations and policy selection.

## Immediate Implementation Status

Implemented in this phase:

- WeChat expert detail responses now expose explicit `experienceCapabilities`.
- Async expert voice replies are capped at 5 free replies.
- WeChat consult UX uses grouped voice drafts and one confirmed send per question bundle.
- Realtime voice is represented as a premium, duration-capped capability in the contract.

Deferred:

- Actual per-expert capability routing persistence
- Scion adapter implementation
- Control-plane admin UI for orchestration switching
- Full observability and cost attribution per capability execution

## Consequences

- Product surfaces can evolve independently from orchestration experiments.
- Cloud-vendor collaboration becomes easier because routing is explicit and capability-scoped.
- On-prem deployments remain credible because the default stack does not depend on proprietary hosted memory or hosted model routing.
- The system becomes more complex at the policy layer, so configuration and observability must be treated as first-class work, not follow-up cleanup.

## Status (verification)

- WeChat UI and expert profile contract updated in this repo
- Voice preview contract updated for 5-reply async posture
- Long-term routing remains documented and not yet fully implemented

# Product Spec: Expert Avatar Service Model

**Status**: Planned

## User Story

As a **player**, I want to understand an expert quickly, hear how they think, and decide whether a paid **meetup** is worth it.

As an expert, I want my public profile, materials, and digital service layer to present my expertise with the right balance of trust, efficiency, and personalization.

## Product Principles

- The experience is **expert-first**, not AI-first.
- Voice is a premium trust-building medium, not a decorative add-on.
- Free preview should help users judge fit, not replace a paid **meetup**.
- Personalization quality is the north-star metric: the system should match the right requirement to the right service at the best quality/price ratio.

## Experience Model

### 1. Public profile

The public expert profile must do three jobs:

- establish trust
- let the user hear the expert
- move the user toward a web login + **schedule meetup** path

Required elements:

- expert identity and proof
- concise service framing
- service-introduction PDF
- voice introduction
- login-first web continuation path

### 2. Free voice preview

The preview interaction is voice-only on WeChat:

- opening the voice-chat surface should greet the player aloud immediately when the device/browser allows it
- greeting and default expert replies should start in English unless the player explicitly asks to continue in another language
- assistant messages should expose an on-demand translation action so the player can quickly view English or Chinese text without leaving the chat
- player records up to 3 short clips as one question bundle
- player confirms once
- expert returns one concise voice reply
- each user receives at most 5 free expert replies
- each reply should fit within 60 seconds

The surface should not emphasize whether the expert or the expert avatar produced the reply.

### 3. Premium realtime talk

Realtime voice is a subscription capability:

- premium only
- capped duration per session
- surfaced in the contract even when temporarily disabled in demo environments

### 4. Formal meetup

Payment, scheduling, and final conversion stay on web:

- login first
- return to the public expert profile
- continue to **paid meetup** checkout from there

## Expert Service Requirements

- Publishing a public profile requires a service-introduction PDF.
- Voice sample remains optional for draft generation, but strongly recommended.
- The platform must support service combinations that differ by expert, cost profile, and orchestration vendor.

## Capability Packaging

Future expert services should be packageable by capability, not only by provider:

- voice reply
- realtime talk
- meeting capture
- memo/reflection
- online content learning
- service matching
- conversion support

An expert may eventually choose a different orchestrator or model profile for different capabilities.

## Acceptance Criteria

- WeChat public profile no longer presents the consult entry as “AI chat”.
- WeChat voice preview uses grouped voice drafts and one explicit send action.
- The public expert profile contract exposes experience capabilities, web continuation URLs, and premium realtime status.
- Publishing fails without a service PDF.
- The long-term service model is documented independently from the implementation details of any one provider.

## Edge Cases

- If no PDF exists, the expert may keep a draft but cannot publish.
- If voice playback fails on WeChat, the UI must surface a meaningful retry/config hint.
- If free preview quota is exhausted, the user should still be directed toward the web continuation path rather than a dead end.

# Design Doc: AI Provider Abstraction

**Status**: Accepted (default provider: Qwen, switchable from `/admin/ai-provider`)
**Date**: 2026-03
**Author**: Tony Wang
**Implemented in**: `src/lib/ai/`, `src/lib/env.ts`

## Context

The platform uses AI for expert matching, profile generation, image creation, text improvement, and speech services. Different providers have different strengths:
- **Qwen**: Best Chinese language support, cost-effective, good for SEA market
- **Gemini**: Google Search grounding, strong reasoning
- **OpenAI**: Broad capability, good English
- **Z.AI**: GLM family for strong Chinese/English reasoning and image generation
- **Dedalus**: Brokered upstream access when a deployment wants a single managed endpoint
- **BytePlus (ModelArk)**: Cost-efficient model hosting. Specifically uses `doubao-seed-1.6-flash` for high-throughput text understanding and generation for **WEB-BYTEPLUS** and **TELEGRAM** endpoints.

Need to switch providers without changing business logic.

## Decision

Factory pattern in `src/lib/ai/index.ts`:

Registry + factory in `src/lib/ai/index.ts` (not a raw switch). Default when unset: **`qwen`**. Supported: `openai`, `zai`, `qwen`, `gemini`, `dedalus`, `byteplus`, `volcengine`.

Model defaults and readiness checks are centralized in `src/lib/ai/provider-catalog.ts`. The admin control plane at `/admin/ai-provider` can:
- switch `AI_PROVIDER`
- pin provider-specific text/image model IDs
- trigger a Vercel redeploy after applying env updates

For profile images, the ordered fallback chain is:

`openai -> zai -> qwen -> gemini -> dedalus`

All providers implement the `AIProvider` interface defined in `src/lib/ai/types.ts`.

### Interface

```typescript
interface AIProvider {
  matchExperts(query, experts, history?): Promise<MatchResult>;
  generateExpertProfile(input): Promise<ProfileOutput>;
  generateProfileImage(input): Promise<string>; // base64
  improveWriting(text): Promise<string>;
  extractTextFromPdf?(buffer): Promise<string>;
}
```

### Fallback Strategy
- AI matching has a keyword-based fallback in the route handler
- If the primary provider fails, the fallback provides basic recommendations
- Prevents 500 errors from reaching users

## Consequences

- **Pro**: Provider switch via single env var, no code changes
- **Pro**: Admins can switch providers and model pins from the product UI instead of editing Vercel env scripts
- **Pro**: Each provider can optimize for its strengths
- **Con**: Feature parity across providers requires maintenance
- **Con**: Some features (Search grounding, TTS/ASR) are provider-specific

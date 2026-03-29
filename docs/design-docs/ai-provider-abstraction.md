# Design Doc: AI Provider Abstraction

**Status**: Accepted (default provider: Qwen — see `src/lib/env.ts`, `src/lib/ai/index.ts`)
**Date**: 2026-03
**Author**: Tony Wang
**Implemented in**: `src/lib/ai/`, `src/lib/env.ts`

## Context

The platform uses AI for expert matching, profile generation, image creation, text improvement, and speech services. Different providers have different strengths:
- **Qwen**: Best Chinese language support, cost-effective, good for SEA market
- **Gemini**: Google Search grounding, strong reasoning
- **OpenAI**: Broad capability, good English

Need to switch providers without changing business logic.

## Decision

Factory pattern in `src/lib/ai/index.ts`:

Registry + factory in `src/lib/ai/index.ts` (not a raw switch). Default when unset: **`qwen`**. Supported: `dedalus`, `gemini`, `qwen`, `openai`.

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
- **Pro**: Each provider can optimize for its strengths
- **Con**: Feature parity across providers requires maintenance
- **Con**: Some features (Search grounding, TTS/ASR) are provider-specific

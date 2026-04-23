# Product Spec: AI Expert Matching

**Status**: Shipped

## User Story

As a founder, I want to describe my problem in natural language and get matched with the most relevant experts.

## Flow

1. Open Discover page → switch to "AI Match" tab
2. Type a description of the problem or need
3. AI analyzes the query against all published experts
4. Returns top 3 recommendations with:
   - Expert name and avatar
   - Match reason (why this expert is relevant)
   - Session types available
5. Click recommendation to view expert profile

## Technical Implementation

- `POST /api/experts/match` with `{ query: string }`
- Fetches all published experts with bio, services, ratings, and memory context
- Enriches with mem9 memory context (if available)
- Sends to AI provider with structured prompt
- Returns `{ recommendations: [...], noMatchMessage?: string }`

## Fallback Strategy

If AI provider fails (rate limit, timeout, parsing error):
1. Log the error
2. Fall back to keyword-based matching
3. Score experts by domain overlap, bio relevance, service match
4. Return top 3 by score, or a no-match message if score = 0

## Acceptance Criteria

- [ ] Relevant experts returned for common queries ("fundraising advice", "legal help")
- [ ] Graceful fallback when AI provider is unavailable
- [ ] Response time < 5 seconds
- [ ] Works from web, Telegram, and WeChat

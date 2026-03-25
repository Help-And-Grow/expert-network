---
name: expert_network
description: Search, discover, and book sessions on Help & Grow — the AI Native Expert Network. Find people by domain (Marketing, Fundraising, Law, Headhunting), check availability, and get booking links.
user-invocable: true
metadata: {"openclaw": {"emoji": "🧠", "homepage": "https://expert-network.vercel.app"}}
---

# Help & Grow (AI Native Expert Network)

You have access to **Help & Grow** — an AI-native network where members are **both expert and learner**: book 1-on-1 consultations (online or offline), discover expertise by domain, and match with natural language.

## Base URL

All API calls use this base:

```
https://expert-network.vercel.app/api/v1
```

## Available Endpoints

### 1. List Domains

Get all expertise domains available on the platform.

```
GET /api/v1/domains
```

Returns: `{ "domains": ["Marketing & BD", "Headhunter", "Law", "Funding"] }`

### 2. Search Experts

Search for experts by keyword, domain, or session type.

```
GET /api/v1/experts?q={query}&domain={domain}&sessionType={type}&limit={n}
```

Parameters (all optional):
- `q` — Free-text search (matches name, bio)
- `domain` — Filter by domain (comma-separated, e.g. `Marketing & BD,Funding`)
- `sessionType` — `ONLINE`, `OFFLINE`, or `BOTH`
- `limit` — Max results, 1–20 (default 10)

Example: `GET /api/v1/experts?q=fundraising&limit=5`

Returns expert list with id, name, bio, domains, rating, pricing, and profile URL.

### 3. Get Expert Profile

Get full details for a specific expert.

```
GET /api/experts/{expertId}
```

Returns full profile including bio, services offered, reviews, pricing, and session type.

### 4. Check Availability

Get available time slots for a specific expert.

```
GET /api/experts/{expertId}/slots
```

Returns `{ "slots": [...], "bookedSlots": [...] }` — use slots where `isBooked` is false and `endTime` is in the future.

### 5. Match Experts

Describe what help you need and get personalized recommendations.

```
GET /api/v1/match?q={description}
```

Example: `GET /api/v1/match?q=I need help with marketing strategy in Southeast Asia`

Returns ranked expert recommendations with match reasons.

## How to Use

Use `web_fetch` to call these endpoints. Examples:

```javascript
// Search for marketing experts
await web_fetch({ url: "https://expert-network.vercel.app/api/v1/experts?q=marketing" });

// Get recommendations based on a need
await web_fetch({ url: "https://expert-network.vercel.app/api/v1/match?q=fundraising for my Series A" });

// Get a specific expert's profile
await web_fetch({ url: "https://expert-network.vercel.app/api/experts/EXPERT_ID_HERE" });

// Check availability
await web_fetch({ url: "https://expert-network.vercel.app/api/experts/EXPERT_ID_HERE/slots" });
```

## Response Handling

- All endpoints return JSON.
- Expert profiles include a `profileUrl` field — share this with the user so they can view the full profile and book directly.
- When showing results, present the expert's name, domains, bio summary, rating, and pricing clearly.
- If no experts match, suggest the user try broader search terms or list available domains using the domains endpoint.

## Workflow

When a user asks for expert help:

1. **Understand the need** — ask clarifying questions if the request is vague.
2. **Match or search** — use `/api/v1/match?q=...` for natural language needs, or `/api/v1/experts?domain=...` for specific domain filtering.
3. **Present results** — show expert name, domains, rating, and a brief bio.
4. **Deep dive** — if the user is interested in a specific expert, fetch their full profile with `/api/experts/{id}`.
5. **Check availability** — use `/api/experts/{id}/slots` to show open time slots.
6. **Direct to booking** — provide the profile URL so the user can book: `https://expert-network.vercel.app/experts/{id}/book`

# Product Sense

## Mission

**Help & Grow** is the **AI Native Expert Network** for people building in **Singapore and Southeast Asia** (and beyond): find the right expertise, **schedule meetups**, and earn recognition and tokens when you help others.

## Vision: service as agent

We are building toward **service as agent**: each expert can have a **digital counterpart** that **continuously learns** from their public presence, meetings (online/offline), reflections, and memos—stays **always on**, **evolves with the expert**, answers questions on the platform, and **facilitates** the human expert.

**Live today:**
- **AI voice avatar** — greets players in the expert's voice, answers questions, caps free previews at 5 replies to protect expert value, and guides toward a paid meetup.
- **Premium live consultation** — when a player and expert are both ready for real-time depth, a booking-scoped TRTC HD video room opens inside the platform on web and WeChat.

**Roadmap:** richer agent memory (meeting transcripts, memos, reflections) feeding back into the avatar so it evolves with every human interaction.

## Everyone is expert, player, and coach

Members are **not** only "buyers" or "sellers." Everyone has expertise worth **sharing** as a service **and** moments where they show up as a **player** and get help from someone else. The product should reinforce **learning by doing** and **growing by helping**.

## User Personas

### Player (often also an expert / coach)

- Founder, operator, or investor who needs specific domain help (legal, fundraising, product, GTM, tech)
- Wants fast, trustworthy matches and low friction to **schedule a meetup**
- May enable **premium live** for high-stakes conversations that need real-time depth
- May also publish a profile and offer sessions in their own domains

### Expert / coach (always still learning)

- Experienced professional offering judgment and practical help—not a one-way lecture
- Wants minimal friction to publish, get scheduled, and get paid reliably
- Benefits from AI-assisted discovery, a voice avatar that represents them while they sleep, and optional live consultation for premium bookings

## Product Principles

1. **AI-native discovery**: Describe needs in natural language; AI matches to the right people
2. **Dual role by design**: UX and copy assume users can be **player and coach** in different contexts
3. **Multi-platform parity**: Same core experience on web, Telegram, and WeChat — enabled by a Tri-Cloud architecture (GCP + Vercel + Tencent Cloud)
4. **Trust through structure**: Verified profiles, transparent pricing, two-way **appreciation** (and coach follow-up), on-chain **Proof of Meet** (POMP via EAS on Base)
5. **Minimal friction**: Expert-style onboarding in minutes (AI-assisted profile from links)
6. **Fair marketplace**: Full upfront payment protects both sides; platform fee is transparent
7. **Token economy**: H&G Token (ERC-20) earned per meetup (1:1 SGD); redeemable for meetup discounts (100:1 SGD); also gates **premium live** access — aligning incentives across players, experts, and the platform

## Infrastructure (platform parity enabler)

Help & Grow runs on a **Tri-Cloud architecture** with **strict data residency** for China users:

| Cloud | Role |
|-------|------|
| **Google Cloud Platform** | Primary backend (Cloud Run), AI engine (Gemini/Vertex AI), global asset storage (GCS) — international users |
| **Vercel** | Edge-optimized web frontend, international traffic |
| **Tencent Cloud** | WeChat Mini Programs, storage (COS), TRTC live consultation |

### WeChat Mini Program Strategy

| App | Company | Positioning | AI Provider | Data Residency |
|-----|----------|-------------|--------------|----------------|
| **International** | Singapore | Free mentoring platform for youth learning AI | Qwen/DashScope (default) | Global (Supabase/Google Cloud) |
| **China Mainland** (future) | Chinese company | Localized expert network | **Hunyuan** (Tencent LLM) | 🔒 **China-only** (separate Tencent Cloud stack) |

**China data residency principle**: The China WeChat app uses a completely separate Tencent Cloud infrastructure stack. All user data is stored and processed **only within China mainland** — no synchronization with the international database.

Runtime providers (storage driver, AI model) are managed via a database-backed `SystemConfig` table — switchable without redeployment.

## Key User Journeys

### Find help → Meetup → Appreciation (player mode)

1. Describe need via AI match or browse the network
2. View expert profile — AI voice avatar greets and answers questions (up to 5 free replies)
3. Select slot(s), optionally enable **premium live** consultation, and pay upfront
4. Attend meetup (Jitsi link for standard; TRTC room for premium live)
5. Leave **appreciation** after the meetup; POMP on-chain attestation minted for both parties

### Premium live consultation (elevated meetup)

1. Player enables the **"Premium live consultation"** toggle at checkout — sees token cost and current balance before confirming
2. System records `isPremiumLive=true` on the `Booking` row at payment
3. 15 minutes before start, a chip appears on the booking dashboard for both parties
4. Either party joins via `/consultation/[bookingId]` (web) or the consultation page (WeChat)
5. Backend mints a time-bound `UserSig` and charges tokens idempotently on first entry
6. In-room: split-tile HD video, mic/camera controls, clean leave flow
7. Room closes automatically 15 minutes after meetup end time

### Offer help → Get scheduled → Get paid (coach mode)

1. Sign up, connect social / context for the AI profile
2. AI-assisted bio and assets (PDF, voice intro); set availability, pricing, session types
3. Stripe Connect for payouts
4. AI voice avatar handles async player questions between meetups
5. Notifications, conduct meetups (standard or premium live); payout settled upfront

### Build reputation → Earn tokens → Redeem (member flywheel)

1. Complete meetups as expert or player → earn H&G tokens (1:1 SGD equivalent)
2. Receive on-chain POMP attestation (EAS on Base) for each meetup — verifiable proof of expertise
3. Redeem tokens for meetup discounts (100:1 SGD) or spend on premium live access
4. Appreciations and POMP attestations compound trust on the profile over time

## AI Stack

| Capability | Provider | Notes |
|-----------|----------|-------|
| Profile generation, matching, bio | **Gemini** (primary, international) | Google Search grounding for expert context |
| Embeddings | `gemini-embedding-001` | Switched from legacy Gemini embedding model |
| Voice chat (async, default) | **Qwen / DashScope** (intl), **Hunyuan** (China) | Gender-matched device voice fallback; China app uses Hunyuan |
| Voice chat (realtime, feature-toggled) | **Qwen / DashScope** (intl), **Hunyuan** (China) | Requires API key; China app uses Hunyuan for data residency |
| TTS | Gemini TTS (configurable) | `GEMINI_EMBEDDING_MODEL` / `TTS_MODEL` env vars |
| AI model registry | `SystemConfig` DB table | Runtime-switchable without redeployment |
| **China WeChat app** | **Hunyuan** (Tencent LLM) | All AI processing stays within China mainland |

## Trust & On-Chain Layer

- **Appreciations** — warm post-meetup notes from the player, displayed on the expert profile.
- **Coach follow-up** — expert's own reflection post-meetup, shown separately in indigo.
- **POMP** (Proof of Meet Protocol) — EAS attestation on Base blockchain for every completed meetup; both parties receive verifiable, portable proof of the interaction.
- **H&G Token** — ERC-20 on Base; earned by participating, spent on platform features; not an investment vehicle.

## Platform APIs (agent integration)

- **MCP server** — exposes Help & Grow expert search and booking to AI agent frameworks.
- **OpenClaw / QClaw skill** — agent-based expert discovery, callable from Claude and compatible agents.
- These surfaces treat the platform as a **service** that AI systems can call on behalf of users — consistent with the *service as agent* north star.

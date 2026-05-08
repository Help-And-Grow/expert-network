# Help & Grow — brand & positioning

Canonical copy for agents, marketing, and in-product messaging. Prefer this over ad-hoc phrasing in new features.

## Name & tagline

- **Product name:** Help & Grow (styling: **Help & Grow** in prose; `Help&Grow` acceptable in tight UI / nav bars.)
- **Positioning line:** **AI Native Expert Network**

## Vision: service as agent

We believe in **service as agent**: a **digital version of each expert** that **continuously learns** from the real expert—through online social presence, online and offline meetings, project reflection, and experience memos—stays **always on**, **evolves with the expert**, answers questions on the platform, and **helps facilitate** the human expert (not replace them).

**Today**, this vision is live as:
- **AI voice chat** — an expert's AI avatar greets players, answers questions in the expert's voice (gender-matched, language-aware), and guides them toward a paid meetup.
- **Premium live consultation** — when both parties are ready for real-time depth, a TRTC-backed HD video room opens inside the platform, charged in H&G tokens.

**Tomorrow**: richer agent memory (memos, meeting transcripts, reflections) feeding back into the avatar so it evolves with every interaction the expert has.

## Community ethos: coach and player in one

**Everyone is both coach and player** (and still an **expert** in their domains): people **share** experience and practical judgment—not a lecture—and show up as **players** when they need help from someone else. On Help & Grow we cultivate **learning by doing** and **growing by helping**.

## Product surfaces

| Surface | Status | Notes |
|---------|--------|-------|
| **Web** (Next.js) | Live | Full feature set; primary conversion surface |
| **Telegram** Mini App | Live | Same API; reaches SEA operators where they already work |
| **WeChat** Mini Program (International) | Live | Registered by Singapore company; **free mentoring platform** helping youth learn AI in building products |
| **WeChat** Mini Program (China) | Planned | Future app by Chinese company; Tencent Cloud (China) + Hunyuan AI; **data stored/processed only in China mainland** |
| **AI Voice Chat** | Live | Async (default) + realtime (feature-toggled); expert gender-matched voice |
| **Premium Live Consultation** | Live (Phases 1–4) | TRTC HD video, token-gated, booking-scoped, web + WeChat |
| **MCP server / OpenClaw** | Live | Exposes Help & Grow as a tool for AI agents |

## Trust & reputation layer

- **Appreciations** — warm post-meetup notes from the player; displayed on the expert's profile.
- **Coach follow-up** — expert's own reflection published after the meetup.
- **POMP (Proof of Meet Protocol)** — on-chain attestation (EAS on Base) for every completed meetup; both expert and player receive verifiable proof.
- **H&G Token** (ERC-20) — earned 1:1 SGD equivalent per meetup; redeemable 100:1 SGD for meetup discounts; also used to gate premium live access.

## Product language (copy)

- Prefer **meetup** over "booking" in user-facing text (URLs and APIs may still say `book` / `bookings`).
- Prefer **appreciation** (and **coach follow-up**) over "review" for post-meetup feedback.
- Prefer **premium live consultation** (not "video call" or "Zoom") for the in-app TRTC experience.
- Prefer **H&G tokens** (not "credits") for the on-platform currency.
- Avoid framing the relationship as one-way **teaching**; emphasize **sharing**, **collaboration**, and **peer** energy where it fits.

## Infrastructure narrative (for technical audiences)

Help & Grow runs on a **Tri-Cloud architecture** designed for global reach and China-local performance:
- **Google Cloud Platform** — primary backend (Cloud Run), AI (Gemini/Vertex AI), global storage (GCS).
- **Vercel** — edge-optimized web frontend, international users.
- **Tencent Cloud** — WeChat Mini Program, China-local storage (COS), TRTC for live consultation.

Runtime provider switching (storage, AI model) is managed via a database-backed `SystemConfig` table — no redeployment required.

### Data residency principle (China)

The **China WeChat Mini Program** (future) will use a **separate Tencent Cloud infrastructure stack** within mainland China:
- **AI provider**: Hunyuan (Tencent's LLM) for China-originated traffic.
- **Data residency**: All user data from the China app is stored and processed **only within China mainland** — separate database, separate object storage, separate AI processing.
- **No data sync** between the China stack and the international stack (SG/SEA users).

## Geography (context, not the headline)

Strong roots in **Singapore and Southeast Asia**; the network is open to founders, experts, and investors who care about this region and AI-era building. The Tri-Cloud infrastructure extends reach into mainland China via the WeChat surface.

## Voice

- Clear, warm, professional; optimistic about AI **augmenting** human expertise.
- Prefer "network" and "community" over cold "marketplace" when describing the whole product.
- When describing live consultation, emphasize **quality** and **depth** — premium live is for conversations that deserve full attention, not a generic video call.

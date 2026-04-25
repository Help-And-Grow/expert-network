# Frontend Architecture

Public copy should align with [**Help & Grow** — AI Native Expert Network](BRAND.md): dual **expert / player / coach** identity, *service as agent* vision, learning by doing / growing by helping, and the **Product language** section in [BRAND.md](BRAND.md) (**meetup**, **appreciation**, sharing over lecturing).

## Routing

Next.js App Router with file-based routing under `src/app/`.

### Public Pages
- `/` — Landing page (home)
- `/auth/signin` — Sign-in (Google OAuth, email magic link)
- `/discover` — Expert discovery with AI matching

### Authenticated Pages
- `/experts/[id]` — Expert profile
- `/experts/[id]/book` — Meetup scheduling flow (slot selection, payment); route name unchanged
- `/booking` — **My Meetups** dashboard (route name unchanged); appreciation and coach follow-up stay inline on each booking card
- `/bookings/checkout-success` — Post-payment confirmation
- `/reviews/[bookingId]` — Redirects to meetups; appreciations are inline on `/booking`
- `/profile` — User settings
- `/onboarding` — Expert registration wizard

## State Management

- **Server state**: Next.js App Router with server components where possible
- **Client state**: React `useState`/`useEffect` for local UI state
- **Auth state**: NextAuth `useSession()` on web; Zustand store in WeChat Mini Program

## Data Fetching Patterns

- API routes: `fetch('/api/...')` from client components
- Telegram Mini App: Same API routes with `x-telegram-init-data` header
- WeChat Mini Program: Same API routes with `x-wechat-token` Authorization header

## MVP Interaction Rules

- Public expert pages are privacy-first: do not render email, Telegram, WeChat, or social IDs.
- Users must not match with, book, or voice-chat with themselves; owner views hide those CTAs.
- MVP voice is system-managed: hide voice-clone controls in product UI and use a professional default voice by gender.
- Free meetups should not mention payment due; offline meetup links should open Google Maps on web when an address is present.
- WeChat and web booking dashboards should both surface player appreciation and coach follow-up directly on the meetup card.

## Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `HomeContent` | `src/components/home-content.tsx` | Landing page hero + features |
| `UserMenu` | `src/components/user-menu.tsx` | Navigation dropdown |
| `WeeklyScheduleEditor` | `src/components/weekly-schedule-editor.tsx` | Availability picker |
| `ExpertCard` | `wechat/src/components/ExpertCard/` | WeChat expert list card |
| `ui/*` | `src/components/ui/` | shadcn/ui primitives |

## WeChat Mini Program Pages

Located in `wechat/src/pages/`:

| Page | Tab bar | Purpose |
|------|---------|---------|
| `index` | Home | Landing page with branding |
| `discover` | Discover | Expert list + AI match chat |
| `expert` | — | Expert detail (navigated to) |
| `book` | — | Date picker + slot selection |
| `dashboard` | Meetups (tab: 见面) | User's meetups list |
| `onboarding` | — | Expert registration |
| `profile` | Me | User settings + share |

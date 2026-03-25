# Frontend Architecture

Public copy should align with [**Help & Grow** — AI Native Expert Network](BRAND.md): dual expert/learner identity, *service as agent* vision, learning by doing / growing by helping.

## Routing

Next.js App Router with file-based routing under `src/app/`.

### Public Pages
- `/` — Landing page (home)
- `/auth/signin` — Sign-in (Google OAuth, email magic link)
- `/discover` — Expert discovery with AI matching

### Authenticated Pages
- `/experts/[id]` — Expert profile
- `/experts/[id]/book` — Booking flow (slot selection, payment)
- `/booking` — User's booking dashboard
- `/bookings/checkout-success` — Post-payment confirmation
- `/reviews/[bookingId]` — Post-session review form
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
| `dashboard` | Bookings | User's sessions list |
| `onboarding` | — | Expert registration |
| `profile` | Me | User settings + share |

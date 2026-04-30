# Design System

## Brand Identity

- **Product**: **Help & Grow** — **AI Native Expert Network**
- **Positioning**: AI-native matching, **meetups**, and *service as agent* — digital experts that learn from their human counterpart, speak in the expert's voice, and facilitate real meetups (including **premium live consultation** via TRTC)
- **Ethos**: Everyone is **expert, player, and coach**; **learning by doing**, **growing by helping**; prefer **sharing** over lecturing
- **Regional context**: Strong Singapore & SEA roots; WeChat surface reaches mainland China via Tencent Cloud
- See [BRAND.md](BRAND.md) for full copy
- **Theme direction**: **dark-first** by default on web, with optional light mode as a future variant
- **Primary color**: Indigo 600 (`#4f46e5`) / gradient `from-indigo-600 to-purple-600`
- **Accent**: Emerald for success, Amber for warnings, Rose for errors

## Component Library

- **Primitives**: shadcn/ui (Radix-based) in `src/components/ui/`
- **Icons**: Lucide React
- **Animation**: Framer Motion for page transitions and interactive elements
- **Typography**: Geist Sans / Geist Mono via `next/font/local`

## Layout Patterns

- **Pages**: Full-width with `max-w-7xl` container, `px-4 sm:px-6 lg:px-8` padding
- **Cards**: Rounded borders (`rounded-2xl`), translucent dark surfaces, soft elevation, backdrop blur
- **Mobile**: Mobile-first responsive design, bottom-safe-area padding for mini programs
- **Shell**: Ambient dark background with subtle indigo/cyan radial lighting; avoid flat solid fills unless used for contained panels

## WeChat Mini Program Design

- Custom navigation bar on landing page (`navigationStyle: "custom"`)
- Status bar safe area: dynamic padding from `Taro.getSystemInfoSync().statusBarHeight`
- Tap feedback via `hoverClass` on all interactive `View` elements
- Horizontal scrolling via `ScrollView` component (not CSS overflow)
- Skeleton loading with shimmer animation for all data-fetching states

## Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `background` | `hsl(224 41% 8%)` | App shell and page background |
| `card` | `hsl(225 32% 12%)` | Elevated cards, modals, panels |
| `popover` | `hsl(225 30% 11%)` | Menus, dropdowns, overlays |
| `primary` | `#4f46e5` | Buttons, links, active states |
| `primary-gradient` | `indigo-600 → purple-600` | Hero sections, CTAs, voice-entry moments |
| `muted` | `hsl(223 24% 15%)` | Secondary surfaces and chips |
| `text-primary` | `hsl(210 40% 98%)` | Headings, main labels |
| `text-secondary` | `hsl(215 20% 72%)` | Descriptions, meta |
| `border` | `hsl(223 21% 23%)` | Dividers, panel outlines |
| `success` | `emerald-400 on emerald-500/10` | Positive states and confirmations |
| `warning` | `amber-300 on amber-500/10` | Warnings, pending states; also token balance warnings |
| `danger` | `rose-300 on rose-500/10` | Errors, destructive flows |

## Dark Theme Rules

- Default web rendering should assume `.dark` on the root HTML element.
- Prefer semantic tokens like `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, and `border-border` over hard-coded slate/white utilities.
- Prefer shared dark surface helpers (`surface-card`, `surface-glass`, tinted alert panels) over ad hoc `bg-white`, `bg-slate-50`, or `shadow-lg` combinations.
- When a component needs emphasis, use contrast by elevation, border, blur, or brand tint instead of switching back to light mode.
- If a page still needs a bright asset area, isolate it inside a contained card rather than making the whole page light.

## Booking & Checkout Patterns

- **Session type toggle**: "Online" / "Offline" selector shown first.
- **Premium live toggle** (online only): appears below session type; shows cost chip ("N H&G tokens" or "Free"), user's current token balance in amber when insufficient, and a "need M more" hint. The toggle is disabled (dimmed) if the player cannot afford it. Hides entirely when TRTC is not configured (`/api/trtc/config` returns 503).
- **Payment summary**: line items in order — meetup price, premium live surcharge (when enabled and cost > 0), full payment total.
- **Token balance**: display inline in the toggle card, not as a separate page element. Color amber (`text-amber-400`) when balance is below the required cost.
- **Free pricing**: feels like a pleasant unlock; never show "payment due: $0" or similar payment-edge-case language.

## Premium Live Consultation UI

### Entry point (booking dashboard)
- Show a chip on each booking card gated by `booking.isPremiumLive && isLiveRoomOpen()` (15 min before → 15 min after meetup end).
- Use an indigo-tinted chip with a camera/video icon; match the platform's dark card style.

### Pre-join state
- Full-page card showing: participant role (founder / expert), room close time, token cost already paid.
- Single "Join room" CTA in indigo gradient.

### In-room layout (web)
- Split-tile: self-view (smaller, corner) + remote participant (dominant).
- Control bar: mic toggle, camera toggle, red "Leave" button.
- Overlay participant name on each tile.
- Handle `REMOTE_USER_ENTER`, `REMOTE_VIDEO_AVAILABLE/UNAVAILABLE`, `REMOTE_AUDIO_*`, `KICKED_OUT` events for tile state.
- On unmount, always call `client.exitRoom()` — never leave a ghost participant.

### WeChat in-room layout
- Native `<live-pusher mode="RTC">` + `<live-player mode="RTC">` components.
- Mic toggle via `LivePusherContext.pause/resume`; camera toggle flips `enableCamera` prop.
- Remote user tracking via pusher `onStateChange` codes 1020 (join) / 1021 (leave).
- Style consistent with the rest of the WeChat Mini Program (dark card surfaces, native button styles).

### States (both platforms)
`loading → ready (pre-join) → joining → in-room → leaving / error`

## Voice Chat Patterns

- One bottom-right profile-image entry point on the expert's public profile.
- Greet the player aloud immediately on surface open (when autoplay is allowed).
- Gender-matched voice: use `pickDeviceVoice(lang, gender)` for device-speech fallback; never let a male expert's avatar speak in a default female device voice.
- Every assistant reply: try generated expert audio first, fall back to device speech if audio is missing or autoplay is blocked.
- Maximum 5 free async replies per player per expert; realtime mode is feature-toggled (`VOICE_CHAT_MODE`).
- Replay controls inside chat; no voice clone in current scope.

## Post-Meetup Feedback Surfaces

- **Appreciation** (player → expert): warm/pink surface; written after the meetup.
- **Coach follow-up** (expert → player): indigo surface; expert's own reflection.
These are two distinct UI surfaces with different tones — do not consolidate into a single "review" widget.

## Product Rules

- Public profiles must not expose direct contact identifiers such as email, Telegram ID, WeChat ID, or social handles.
- Treat owner-state as a separate mode: when the viewer is the expert, hide match, booking, and voice-chat actions instead of showing disabled controls.
- Voice clone is out of scope. Use one bottom-right profile-image audio entry point plus replay controls inside chat, backed by a system-selected professional voice by gender.
- Premium live consultation is in scope and live (Phases 1–4 shipped). Entry is gated by `isPremiumLive` flag and the live window; the token debit is idempotent and booking-scoped.
- Free pricing should feel like a pleasant unlock, not a payment edge case. Remove payment-due language from zero-price experiences.
- TRTC secrets (`TRTC_APP_ID`, `TRTC_SECRET_KEY`) are never exposed client-side. `UserSig` is always generated server-side with a time-bound TTL.

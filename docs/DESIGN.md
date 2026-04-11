# Design System

## Brand Identity

- **Product**: **Help & Grow** — **AI Native Expert Network**
- **Positioning**: AI-native matching, **meetups**, and (roadmap) *service as agent* — digital experts that learn from their human counterpart and facilitate real meetups
- **Ethos**: Everyone is **expert, player, and coach**; **learning by doing**, **growing by helping**; prefer **sharing** over lecturing
- **Regional context**: Strong Singapore & SEA roots (not the only headline)
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
| `warning` | `amber-300 on amber-500/10` | Warnings, pending states |
| `danger` | `rose-300 on rose-500/10` | Errors, destructive flows |

## Dark Theme Rules

- Default web rendering should assume `.dark` on the root HTML element.
- Prefer semantic tokens like `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, and `border-border` over hard-coded slate/white utilities.
- Prefer shared dark surface helpers (`surface-card`, `surface-glass`, tinted alert panels) over ad hoc `bg-white`, `bg-slate-50`, or `shadow-lg` combinations.
- When a component needs emphasis, use contrast by elevation, border, blur, or brand tint instead of switching back to light mode.
- If a page still needs a bright asset area, isolate it inside a contained card rather than making the whole page light.

## MVP Product Rules

- Public profiles must not expose direct contact identifiers such as email, Telegram ID, WeChat ID, or social handles.
- Treat owner-state as a separate mode: when the viewer is the expert, hide match, booking, and voice-chat actions instead of showing disabled controls.
- Voice clone is out of MVP scope. Use one bottom-right profile-image audio entry point plus replay controls inside chat, backed by a system-selected professional voice by gender.
- Post-meetup feedback uses two distinct surfaces:
  - appreciation: warm/pink, written by the player
  - coach follow-up: indigo, written by the coach
- Free pricing should feel like a pleasant unlock, not a payment edge case. Remove deposit language from zero-price experiences.

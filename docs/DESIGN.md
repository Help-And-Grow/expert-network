# Design System

## Brand Identity

- **Product**: **Help & Grow** — **AI Native Expert Network**
- **Positioning**: AI-native matching, booking, and (roadmap) *service as agent* — digital experts that learn from their human counterpart and facilitate real sessions
- **Ethos**: Everyone is **expert and learner**; **learning by doing**, **growing by helping**
- **Regional context**: Strong Singapore & SEA roots (not the only headline)
- See [BRAND.md](BRAND.md) for full copy
- **Primary color**: Indigo 600 (`#4f46e5`) / gradient `from-indigo-600 to-purple-600`
- **Accent**: Emerald for success, Amber for warnings, Rose for errors

## Component Library

- **Primitives**: shadcn/ui (Radix-based) in `src/components/ui/`
- **Icons**: Lucide React
- **Animation**: Framer Motion for page transitions and interactive elements
- **Typography**: System font stack with `font-sans`

## Layout Patterns

- **Pages**: Full-width with `max-w-7xl` container, `px-4 sm:px-6 lg:px-8` padding
- **Cards**: Rounded borders (`rounded-xl`), subtle shadows, hover states
- **Mobile**: Mobile-first responsive design, bottom-safe-area padding for mini programs

## WeChat Mini Program Design

- Custom navigation bar on landing page (`navigationStyle: "custom"`)
- Status bar safe area: dynamic padding from `Taro.getSystemInfoSync().statusBarHeight`
- Tap feedback via `hoverClass` on all interactive `View` elements
- Horizontal scrolling via `ScrollView` component (not CSS overflow)
- Skeleton loading with shimmer animation for all data-fetching states

## Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `primary` | `#4f46e5` | Buttons, links, active states |
| `primary-gradient` | `indigo-600 → purple-600` | Hero sections, CTAs |
| `surface` | `#f8fafc` (slate-50) | Page backgrounds |
| `card` | `#ffffff` | Card backgrounds |
| `text-primary` | `#0f172a` (slate-900) | Headings |
| `text-secondary` | `#64748b` (slate-500) | Descriptions, meta |
| `border` | `#e2e8f0` (slate-200) | Dividers, card borders |

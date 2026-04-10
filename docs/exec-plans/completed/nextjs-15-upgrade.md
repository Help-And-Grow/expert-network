# Execution plan: Next.js 15 upgrade

**Status:** Completed (build verified locally)  
**Completed:** 2026-03-24  
**Owner:** Engineering  
**Target:** `expert-network` (Vercel, App Router)

## Completion log

- Upgraded to **Next.js 15.5.14** and **eslint-config-next 15.5.14** (React 18 retained).
- `next.config.mjs`: `serverExternalPackages` + **`outputFileTracingRoot`** (fixes stray lockfile tracing warning when a parent `package-lock.json` exists).
- `src/app/auth/error/page.tsx`: async page + `searchParams: Promise<{ error?: string }>`.
- `tsconfig.json`: Next set **`target`: `ES2017`** (top-level await).
- **`npm run build`**: passed (Prisma generate + typecheck + lint). Existing ESLint warning: `onboarding/page.tsx` `useEffect` deps (pre-existing).
- **Manual QA** (auth, Stripe, E2E): not run in this session — run on **Vercel preview** before relying on production.

## Goal

Upgrade from **Next.js 14.2.x** to **Next.js 15** with no regressions to auth, payments, or multi-client flows (web, Telegram, WeChat).

## Preconditions

- [x] Branch / workspace ready for upgrade.
- [x] Official upgrade guide consulted during implementation.

## Scope (in)

- Bump `next`, `eslint-config-next`, and aligned types/tooling.
- Fix **async dynamic APIs** where required (`searchParams` / `params` on Server Components).
- Migrate `next.config.mjs` (`serverExternalPackages`).
- Verify **next-auth v4** still works; document outcome or schedule Auth.js v5 follow-up **out of scope** unless blocking.

## Scope (out)

- **Auth.js v5** migration (optional follow-up plan).
- **React 19** upgrade unless required by chosen Next 15 minor (try **React 18** first if supported by your target `next` version; bump to 19 if the framework requires it).
- WeChat / Taro app (separate repo path under `wechat/` — only if Next upgrade indirectly affects shared contracts).

## Implementation steps

### 1. Dependencies

- [x] Bump `next` to **15.5.14**.
- [x] Bump `eslint-config-next` to match.
- [x] `npm install` (React 18 peers satisfied).
- [x] `prisma generate` via build script.

### 2. Config

- [x] `serverExternalPackages` at root (replaces `experimental.serverComponentsExternalPackages`).
- [x] `outputFileTracingRoot` for monorepo / stray lockfile cases.

### 3. Code changes (async request APIs)

- [x] **`src/app/auth/error/page.tsx`** — async + `await searchParams`.
- [x] No other server `page.tsx` / `layout.tsx` with sync `params`/`searchParams` found.

### 4. Codemods (optional but recommended)

- [ ] Skipped — manual diff was minimal.

### 5. Quality gates

- [x] `npm run build` (includes lint + typecheck in Next 15 pipeline).
- [ ] `npm run lint` standalone (optional; build ran ESLint).

### 6. Manual QA checklist (staging or preview deploy)

**Auth**

- [ ] Google OAuth sign-in / sign-out
- [ ] Email magic link
- [ ] `/auth/error` with a forced error query (e.g. invalid callback) renders correctly

**Money**

- [ ] Stripe Checkout (test mode): schedule meetup → pay → success URL
- [ ] Stripe webhook still receives events (Vercel logs)

**Core product**

- [ ] Expert discover + expert detail + book flow
- [ ] Onboarding generate step (AI + `maxDuration` route still OK)

**Optional clients**

- [ ] Telegram mini-app auth path (if used in staging)
- [ ] WeChat token header path (if testable)

### 7. Deploy

- [ ] Merge to `main` after green preview + QA.
- [ ] Watch Vercel build and first-hour errors (runtime logs).

### 8. Rollback

- Revert PR or redeploy previous production deployment if critical regression.

## Follow-ups (separate tickets)

- [ ] **next-auth → Auth.js v5** when ready (cleaner long-term on App Router).
- [x] **AGENTS.md** framework line → Next.js 15.
- [ ] Run **manual QA** on preview deploy.

## Acceptance criteria

- [x] **Green `npm run build`** on Next 15 locally.
- [ ] Production/preview: no S1 on auth or payments after manual QA.

## References

- [Next.js 15 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15)
- [Next.js 15 blog / release notes](https://nextjs.org/blog/next-15)
- Internal: `next.config.mjs`, `src/app/auth/error/page.tsx`, `package.json`

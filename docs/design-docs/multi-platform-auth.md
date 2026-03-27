# Design Doc: Multi-Platform Authentication

**Status**: Accepted
**Date**: 2026-03
**Author**: Tony Wang

## Context

The platform serves three client surfaces:
1. Web browser (Google OAuth, email magic links)
2. Telegram Mini App (initData HMAC)
3. WeChat Mini Program (code2session)

API routes need to authenticate users from any platform without per-route platform checks.

## Options Considered

1. **Separate auth middleware per platform**: Each route explicitly checks its platform
2. **Unified resolver function**: Single function tries all auth methods in priority order
3. **API gateway with auth proxy**: External service handles auth, forwards user ID

## Decision

Option 2 — `resolveUserId(request)` in `src/lib/request-auth.ts`.

The function checks headers in order:
1. `x-wechat-token` → JWT verify → lookup by user id
2. `x-telegram-init-data` → HMAC verify → lookup by telegramId
3. `tg_user_id` cookie → user id lookup
4. Auth.js (NextAuth v5) → `auth()` reads the `authjs.session-token` cookie → `session.user.id`

## Consequences

- **Pro**: Any API route authenticates all platforms with one call
- **Pro**: New platforms only require adding a new check to the resolver
- **Con**: Header-based auth (Telegram, WeChat) bypasses NextAuth's CSRF protection
- **Mitigation**: Telegram uses cryptographic initData; WeChat uses server-side code2session

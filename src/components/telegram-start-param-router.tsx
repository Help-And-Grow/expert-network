"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Reads `Telegram.WebApp.initDataUnsafe.start_param` on Mini-App boot and
 * routes the user to the matching internal page. Used by the group-reply
 * deep links emitted from `src/app/api/webhooks/telegram/route.ts` —
 * `t.me/<bot>/<app>?startapp=expert-<id>` opens this app at `/` with
 * `start_param = "expert-<id>"`, and we forward to `/experts/<id>` so the
 * user lands on the right page with full Telegram Mini-App auth context.
 *
 * Supported prefixes:
 *   - `expert-<id>`   → /experts/<id>
 *   - `book-<id>`     → /experts/<id>/book
 *   - `review-<id>`   → /reviews/<bookingId>   (post-meetup review)
 *   - `profile-edit`  → /profile               (user/expert profile editor)
 *
 * Only fires on the entry path ("/") so an already-routed user isn't
 * yanked away by a stale start_param. Uses `router.replace` so the back
 * button doesn't bounce to "/". Renders nothing.
 */
type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: { start_param?: string };
  ready?: () => void;
  expand?: () => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const EXPERT_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function TelegramStartParamRouter() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    // Tell Telegram the Mini App has loaded — required for theme + safe-area
    // sync. Cheap to call multiple times.
    tg.ready?.();
    tg.expand?.();

    // start_param only meaningful on the initial entry page.
    if (pathname !== "/") return;

    const param = tg.initDataUnsafe?.start_param;
    if (!param) return;

    if (param.startsWith("expert-")) {
      const id = param.slice("expert-".length);
      if (EXPERT_ID_RE.test(id)) {
        router.replace(`/experts/${id}`);
      }
      return;
    }

    if (param.startsWith("book-")) {
      const id = param.slice("book-".length);
      if (EXPERT_ID_RE.test(id)) {
        router.replace(`/experts/${id}/book`);
      }
      return;
    }

    if (param.startsWith("review-")) {
      const id = param.slice("review-".length);
      if (EXPERT_ID_RE.test(id)) {
        // /reviews/<bookingId> — server-side gates submission to
        // the founder of a COMPLETED booking; unauthorised users land
        // on the redirect target.
        router.replace(`/reviews/${id}`);
      }
      return;
    }

    if (param === "profile-edit") {
      // Profile page is a single unified surface (user fields + expert
      // fields toggled inline) — no separate /profile/edit route today.
      router.replace("/profile");
      return;
    }
    // Unknown prefix — stay at "/" silently. Adding a new prefix here is
    // additive: also extend the webhook in
    // `src/app/api/webhooks/telegram/route.ts` to emit the matching link.
  }, [router, pathname]);

  return null;
}

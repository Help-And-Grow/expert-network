/**
 * Telegram Mini App — client-safe utilities only.
 * Server-side validation lives in telegram-server.ts to avoid pulling
 * node:crypto into client bundles.
 */

/**
 * Returns true when the app is running inside a Telegram Mini App WebView.
 * Only trusts `initData` — it's the sole field guaranteed to be non-empty
 * exclusively inside a real Mini App. The SDK's `platform` is set even in
 * regular browsers and must NOT be used as a signal.
 * Safe to call during SSR (returns false).
 */
export function isTelegramMiniApp(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webApp = (window as any).Telegram?.WebApp;
  if (!webApp) return false;
  return typeof webApp.initData === "string" && webApp.initData.length > 0;
}

/**
 * Returns raw Telegram initData when inside Mini App; otherwise null.
 */
export function getTelegramInitData(): string | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webApp = (window as any).Telegram?.WebApp;
  if (!webApp || typeof webApp.initData !== "string" || webApp.initData.length === 0) {
    return null;
  }
  return webApp.initData;
}

/**
 * Bot username + Mini App slug used to build t.me deep links.
 *
 * These are public identifiers (visible to anyone in Telegram), so client-side
 * exposure is fine. Override via NEXT_PUBLIC_* env vars when deploying with a
 * different bot or app — defaults match the production @helpAndGrowBot setup.
 */
const TG_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim() || "helpAndGrowBot";
const TG_MINI_APP_SLUG =
  process.env.NEXT_PUBLIC_TELEGRAM_MINI_APP_SLUG?.trim() || "ExpertNetwork";

/**
 * Construct a t.me deep link into our Mini App with an optional start_param.
 * When a Telegram user taps this URL anywhere in Telegram, the Mini App opens
 * (with auth context) and `<TelegramStartParamRouter>` routes by prefix:
 *
 *   telegramMiniAppLink(`expert-${id}`)     → /experts/<id>
 *   telegramMiniAppLink(`book-${id}`)       → /experts/<id>/book
 *   telegramMiniAppLink(`review-${id}`)     → /reviews/<id>
 *   telegramMiniAppLink(`profile-edit`)     → /profile
 *   telegramMiniAppLink()                   → /
 */
export function telegramMiniAppLink(startParam?: string): string {
  const base = `https://t.me/${TG_BOT_USERNAME}/${TG_MINI_APP_SLUG}`;
  if (!startParam) return base;
  return `${base}?startapp=${encodeURIComponent(startParam)}`;
}

/**
 * Open an external URL safely from a Mini App.
 * In Telegram: uses WebApp.openLink() to open in external browser.
 * In web: uses window.open().
 */
export function openExternalUrl(url: string) {
  if (typeof window === "undefined") return;
  const resolvedUrl = new URL(url, window.location.origin).toString();

  if (isTelegramMiniApp()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webApp = (window as any).Telegram?.WebApp;
    if (typeof webApp?.openLink === "function") {
      webApp.openLink(resolvedUrl, { try_instant_view: false });
      return;
    }
  }

  const opened = window.open(resolvedUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.assign(resolvedUrl);
  }
}

export type ShareResult = "telegram" | "web-share" | "copied" | "cancelled";

/**
 * Share a URL with optional text. Picks the best channel for the runtime:
 * - Telegram Mini App → opens Telegram's native share sheet via t.me/share/url.
 *   If `telegramDeepLink` is provided, that URL is shared instead of the web
 *   URL — so the recipient lands inside the Mini App (with auth + theme)
 *   rather than the in-app browser when they tap the forwarded link.
 * - Browser with Web Share API → navigator.share()
 * - Otherwise → copies to clipboard
 */
export async function shareLink(input: {
  url: string;
  text?: string;
  mode?: "auto" | "copy";
  /**
   * Optional t.me/<bot>/<app>?startapp=... deep link to share *instead of*
   * `url` when running inside the Mini App. Construct via `telegramMiniAppLink`.
   */
  telegramDeepLink?: string;
}): Promise<ShareResult> {
  if (typeof window === "undefined") return "cancelled";
  const absoluteUrl = new URL(input.url, window.location.origin).toString();
  const shareText = input.text ?? "";
  const clipboardText = shareText ? `${shareText} ${absoluteUrl}` : absoluteUrl;

  if (isTelegramMiniApp()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webApp = (window as any).Telegram?.WebApp;
    // Prefer the Mini App deep link when given so the recipient opens our
    // Mini App, not the in-app browser. Falls back to the absolute web URL
    // when no deep link was provided (non-Mini-App-deep-linkable surface).
    const shareUrl = input.telegramDeepLink ?? absoluteUrl;
    const params = new URLSearchParams({ url: shareUrl, text: shareText });
    const tgShareUrl = `https://t.me/share/url?${params.toString()}`;
    if (typeof webApp?.openTelegramLink === "function") {
      webApp.openTelegramLink(tgShareUrl);
      return "telegram";
    }
  }

  if (input.mode === "copy") {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(clipboardText);
        return "copied";
      } catch {
      }
    }

    window.prompt("Copy this message", clipboardText);
    return "copied";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  if (typeof nav?.share === "function") {
    try {
      await nav.share({ url: absoluteUrl, text: shareText });
      return "web-share";
    } catch (error) {
      const e = error as { name?: string };
      if (e?.name === "AbortError") return "cancelled";
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(clipboardText);
    return "copied";
  }

  window.prompt("Copy this message", clipboardText);
  return "copied";
}

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
 * - Telegram Mini App → opens Telegram's native share sheet via t.me/share/url
 * - Browser with Web Share API → navigator.share()
 * - Otherwise → copies to clipboard
 */
export async function shareLink(input: {
  url: string;
  text?: string;
}): Promise<ShareResult> {
  if (typeof window === "undefined") return "cancelled";
  const absoluteUrl = new URL(input.url, window.location.origin).toString();
  const shareText = input.text ?? "";

  if (isTelegramMiniApp()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webApp = (window as any).Telegram?.WebApp;
    const params = new URLSearchParams({ url: absoluteUrl, text: shareText });
    const tgShareUrl = `https://t.me/share/url?${params.toString()}`;
    if (typeof webApp?.openTelegramLink === "function") {
      webApp.openTelegramLink(tgShareUrl);
      return "telegram";
    }
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
    await navigator.clipboard.writeText(absoluteUrl);
    return "copied";
  }

  window.prompt("Copy this link", absoluteUrl);
  return "copied";
}

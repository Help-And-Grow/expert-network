/**
 * Disposable / throwaway email domain check — Phase 4 hardening of the
 * guest-booking flow (docs/exec-plans/active/guest-booking.md §6, §8).
 *
 * Why hardcode rather than fetch a public list at runtime:
 *   - The list rarely changes; the burn-after-use disposable services that
 *     matter for booking abuse are well-known and stable.
 *   - Avoids a network call on every booking and a 3rd-party dependency.
 *   - Curated list keeps false positives near zero — we do not block
 *     enterprise providers that *also* offer aliasing (gmail.com, yahoo.com,
 *     outlook.com, icloud.com, etc.) because legitimate users land there.
 *
 * If real abuse appears, swap this for an upstream like
 * https://github.com/disposable/disposable-email-domains and run a
 * monthly cron to refresh — the function signature is stable.
 */

/**
 * Known disposable / throwaway email domains. Lowercase, no `@`. Sourced from
 * the most common abuse patterns; expand as needed.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "discard.email",
  "discardmail.com",
  "dispostable.com",
  "fakeinbox.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "incognitomail.org",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "maildrop.cc",
  "mailtemp.email",
  "mintemail.com",
  "mohmal.com",
  "mt2014.com",
  "mt2015.com",
  "noemailpls.com",
  "notmailinator.com",
  "sharklasers.com",
  "sogetthis.com",
  "spam4.me",
  "spambox.us",
  "tempinbox.com",
  "tempmail.com",
  "tempmail.io",
  "tempmail.ninja",
  "tempmailaddress.com",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "trashmail.net",
  "trbvm.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

/**
 * Returns the lowercased email domain if `email` parses as a valid-looking
 * address with one `@` and a dotted TLD; otherwise null.
 */
function parseDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain.includes(".")) return null;
  return domain;
}

/**
 * Returns `true` if the domain part of `email` is a known disposable mailbox.
 * Case-insensitive. Returns `false` for unparseable inputs (let zod handle the
 * "invalid email" message; this function is *only* about disposable detection).
 */
export function isDisposableEmail(email: string): boolean {
  const domain = parseDomain(email);
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/** Test-only: number of domains in the blocklist (sanity-check imports). */
export const DISPOSABLE_DOMAIN_COUNT = DISPOSABLE_EMAIL_DOMAINS.size;

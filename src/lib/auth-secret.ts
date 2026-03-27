/**
 * Auth.js v5 prefers AUTH_SECRET; NEXTAUTH_SECRET remains supported for Vercel/env parity.
 */
export function getAuthSecret(): string | undefined {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
}

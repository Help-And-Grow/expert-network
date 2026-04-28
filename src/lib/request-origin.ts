/**
 * Minimal contract: anything with a `headers.get(name)` lookup. Both
 * `NextRequest` and `Request` satisfy this; using a structural type avoids
 * pulling Next types into modules that just want to inspect a header.
 */
export type HeaderBearingRequest = {
  headers: { get(name: string): string | null };
};

/**
 * Detects whether a request originated from the WeChat Mini Program by
 * inspecting headers stamped by the TCB proxy (`infra/tcb-proxy/index.js`).
 *
 * Used by the storage factory to auto-route uploads to Tencent COS and by
 * the AI factory to route inference to a CN-friendly provider for
 * China-mainland users — bypassing the cross-firewall round-trip that
 * `gcs` / `vercel` / Gemini would otherwise impose.
 */
export function isWeChatOriginatedRequest(
  request: HeaderBearingRequest | undefined | null,
): boolean {
  if (!request) return false;
  const via = request.headers.get("x-forwarded-via");
  const from = request.headers.get("x-forwarded-from");
  return via === "tcb-proxy" || from === "wechat";
}

import type { NextRequest } from "next/server";

/**
 * Detects whether a request originated from the WeChat Mini Program by
 * inspecting headers stamped by the TCB proxy (`infra/tcb-proxy/index.js`).
 *
 * Used by the storage factory to auto-route uploads to Tencent COS for
 * China-mainland users — bypassing the cross-firewall round-trip that
 * `gcs` / `vercel` would otherwise impose.
 */
export function isWeChatOriginatedRequest(request: Pick<NextRequest, "headers"> | undefined | null): boolean {
  if (!request) return false;
  const via = request.headers.get("x-forwarded-via");
  const from = request.headers.get("x-forwarded-from");
  return via === "tcb-proxy" || from === "wechat";
}

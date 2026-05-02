/**
 * Minimal contract: anything with a `headers.get(name)` lookup. Both
 * `NextRequest` and `Request` satisfy this; using a structural type avoids
 * pulling Next types into modules that just want to inspect a header.
 */
export type HeaderBearingRequest = {
  headers: { get(name: string): string | null };
};

const buildTargetIsWeChat = process.env.WECHAT_BUILD_TARGET === "wechat";
const buildWeChatRegion = process.env.WECHAT_STACK_REGION?.toLowerCase();

function readRuntimeEnv(name: string): string | undefined {
  return (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name];
}

/**
 * Detects whether a request originated from the WeChat Mini Program by
 * inspecting either the SCF deployment marker (`IS_WECHAT=true`) or headers
 * stamped by the older TCB proxy path (`infra/tcb-proxy/index.js`).
 *
 * Used by the storage factory to auto-route uploads to Tencent COS and by
 * the AI factory to route WeChat inference to Tencent Hunyuan.
 */
export function isWeChatOriginatedRequest(
  request: HeaderBearingRequest | undefined | null,
): boolean {
  if (buildTargetIsWeChat) return true;
  if (readRuntimeEnv("IS_WECHAT") === "true") return true;
  if (!request) return false;
  const via = request.headers.get("x-forwarded-via");
  const from = request.headers.get("x-forwarded-from");
  return via === "tcb-proxy" || from === "wechat";
}

export type WeChatRegion = "cn" | "intl";

/**
 * Returns the regional stack the WeChat client is bound to. The current SCF
 * deployment sets `PROXY_REGION`; the older TCB proxy path can also stamp
 * `x-forwarded-region`. Null when the request is not WeChat-originated or no
 * region is configured.
 *
 * - `cn`   → future mainland China stack
 * - `intl` → current international WeChat stack on Tencent CloudBase + Hunyuan
 */
export function getWeChatRegion(
  request: HeaderBearingRequest | undefined | null,
): WeChatRegion | null {
  if (!isWeChatOriginatedRequest(request)) return null;
  const value =
    request?.headers.get("x-forwarded-region")?.toLowerCase() ||
    readRuntimeEnv("PROXY_REGION")?.toLowerCase() ||
    buildWeChatRegion;
  if (value === "cn" || value === "intl") return value;
  return null;
}

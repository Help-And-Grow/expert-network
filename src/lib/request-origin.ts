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
 * Detects whether a request originated from the WeChat Mini Program. Signals,
 * in priority order:
 *
 *   1. `WECHAT_BUILD_TARGET=wechat` build-time env.
 *   2. `IS_WECHAT=true` runtime env (SCF deploys dedicated to a WeChat region).
 *   3. Per-request headers:
 *      - `x-wechat-token` — set on every request by the Mini Program's
 *        `wechat/src/shared/api.ts`. This is the canonical signal now that
 *        the TCB proxy has been retired and the Mini Program calls Vercel
 *        directly.
 *      - `x-forwarded-via: tcb-proxy` / `x-forwarded-from: wechat` — legacy
 *        stamps from the old TCB proxy path; kept so any straggler deploys
 *        still route correctly.
 *
 * Used by the storage factory (Tencent COS) and the AI factory (Hunyuan).
 * Misclassifying a WeChat call as Web/Telegram routes it through the
 * Qwen→Gemini chain, which on Vercel `sin1` regularly exceeds the 60 s
 * `maxDuration` for `/api/experts/match` and surfaces as the
 * "这次匹配没有成功" toast on the discover page.
 */
export function isWeChatOriginatedRequest(
  request: HeaderBearingRequest | undefined | null,
): boolean {
  if (buildTargetIsWeChat) return true;
  if (readRuntimeEnv("IS_WECHAT") === "true") return true;
  if (!request) return false;
  if (request.headers.get("x-wechat-token")) return true;
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

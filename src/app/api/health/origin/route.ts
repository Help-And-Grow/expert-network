import { type NextRequest, NextResponse } from "next/server";

import { getWeChatRegion, isWeChatOriginatedRequest } from "@/lib/request-origin";

/**
 * Echoes the origin signals so operators can verify the TCB proxy is stamping
 * traffic correctly end-to-end.
 *
 * Expected after `tcb framework deploy -c cloudbaserc.cn.json`:
 *   $ curl https://<cn-tcb-url>/api/health/origin
 *   { "ok":true, "wechat":true, "region":"cn",   "via":"tcb-proxy", "from":"wechat" }
 *
 * Expected after `tcb framework deploy -c cloudbaserc.intl.json`:
 *   $ curl https://<intl-tcb-url>/api/health/origin
 *   { "ok":true, "wechat":true, "region":"intl", "via":"tcb-proxy", "from":"wechat" }
 *
 * From a regular browser hit on Vercel:
 *   $ curl https://expert-network.vercel.app/api/health/origin
 *   { "ok":true, "wechat":false, "region":null, "via":null, "from":null }
 */
export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    wechat: isWeChatOriginatedRequest(request),
    region: getWeChatRegion(request),
    via: request.headers.get("x-forwarded-via"),
    from: request.headers.get("x-forwarded-from"),
  });
}

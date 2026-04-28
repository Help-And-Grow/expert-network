import { type NextRequest, NextResponse } from "next/server";

import { isWeChatOriginatedRequest } from "@/lib/request-origin";

/**
 * Echoes the origin signals so operators can verify the TCB proxy is stamping
 * traffic correctly end-to-end.
 *
 * Expected after `tcb framework deploy` of `infra/tcb-proxy/`:
 *   $ curl https://<tcb-domain>/api/health/origin
 *   { "ok": true, "wechat": true, "via": "tcb-proxy", "from": "wechat" }
 *
 * From a regular browser hit on Vercel:
 *   $ curl https://expert-network.vercel.app/api/health/origin
 *   { "ok": true, "wechat": false, "via": null, "from": null }
 */
export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    wechat: isWeChatOriginatedRequest(request),
    via: request.headers.get("x-forwarded-via"),
    from: request.headers.get("x-forwarded-from"),
  });
}

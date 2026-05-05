import { type NextRequest, NextResponse } from "next/server";

import { getWeChatRegion, isWeChatOriginatedRequest } from "@/lib/request-origin";

/**
 * Echoes the origin signals so operators can verify the CloudBase/SCF WeChat
 * backend is classified correctly end-to-end.
 *
 * Expected on the current international WeChat SCF deployment:
 *   $ curl https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com/api/health/origin
 *   { "ok":true, "wechat":true, "region":"intl", "via":null, "from":null }
 *
 * From a regular browser hit on Vercel:
 *   $ curl https://www.help-and-grow.com/api/health/origin
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

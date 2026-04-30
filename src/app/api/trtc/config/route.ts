import { type NextRequest, NextResponse } from "next/server";

import { isWeChatOriginatedRequest } from "@/lib/request-origin";
import { getTrtcConfig, isTrtcConfigured } from "@/lib/trtc";

/**
 * Public read-only TRTC config — surfaces the premium-live cost surface so
 * the booking UI can render the opt-in toggle without an authenticated call.
 *
 * Two entitlement modes:
 *   - WeChat MP path: `entitlement: "membership"` — gating is handled by
 *     the user's active subscription, not a per-room token charge. The
 *     `premiumLiveTokens` value is still returned for completeness but the
 *     UI should ignore it on this path.
 *   - Web / Telegram path: `entitlement: "tokens"` — H&G tokens are debited
 *     once per booking the first time `/api/trtc/token` succeeds.
 *
 * Returns 503 when TRTC is not configured for the deployment so the
 * booking page can hide the toggle entirely. No secrets are exposed —
 * `getTrtcConfig` only reads the public app id and the cost value.
 */
export async function GET(request: NextRequest) {
  if (!isTrtcConfigured()) {
    return NextResponse.json(
      { configured: false, premiumLiveTokens: 0 },
      { status: 503 },
    );
  }

  const { premiumLiveTokens, prejoinSeconds, postEndGraceSeconds } =
    getTrtcConfig();

  return NextResponse.json({
    configured: true,
    entitlement: isWeChatOriginatedRequest(request) ? "membership" : "tokens",
    premiumLiveTokens,
    prejoinSeconds,
    postEndGraceSeconds,
  });
}

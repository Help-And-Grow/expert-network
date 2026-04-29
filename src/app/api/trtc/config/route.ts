import { NextResponse } from "next/server";

import { getTrtcConfig, isTrtcConfigured } from "@/lib/trtc";

/**
 * Public read-only TRTC config — surfaces the premium-live token cost so
 * the booking UI can show "Costs N H&G tokens" inside the opt-in toggle
 * without requiring an authenticated /api/trtc/token call.
 *
 * Returns 503 when TRTC is not configured for the deployment so the
 * booking page can hide the toggle entirely. No secrets are exposed —
 * `getTrtcConfig` only reads the public app id and the cost value.
 */
export async function GET() {
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
    premiumLiveTokens,
    prejoinSeconds,
    postEndGraceSeconds,
  });
}

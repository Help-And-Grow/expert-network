import { type NextRequest, NextResponse } from "next/server";

import { fetchPlaceFormattedAddress, isGooglePlacesConfigured } from "@/lib/google-places-server";
import { resolveUserId } from "@/lib/request-auth";

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isGooglePlacesConfigured()) {
      return NextResponse.json({ ok: false, configured: false, formattedAddress: null });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : "";
    const sessionToken =
      typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";

    if (!placeId || placeId.length > 512) {
      return NextResponse.json({ error: "placeId is required" }, { status: 400 });
    }
    if (sessionToken.length < 8 || sessionToken.length > 128) {
      return NextResponse.json({ error: "sessionToken is required" }, { status: 400 });
    }

    const formattedAddress = await fetchPlaceFormattedAddress(placeId, sessionToken);

    return NextResponse.json({
      ok: true,
      configured: true,
      formattedAddress,
    });
  } catch (e) {
    console.error("[api/places/details]", e);
    return NextResponse.json({ error: "Place details failed" }, { status: 500 });
  }
}

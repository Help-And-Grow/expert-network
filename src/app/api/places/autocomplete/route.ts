import { type NextRequest, NextResponse } from "next/server";

import {
  fetchPlaceAutocompleteSuggestions,
  isGooglePlacesConfigured,
} from "@/lib/google-places-server";
import { resolveUserId } from "@/lib/request-auth";

const MIN_INPUT = 4;
const MAX_INPUT = 256;

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isGooglePlacesConfigured()) {
      return NextResponse.json({
        ok: true,
        configured: false,
        suggestions: [] as [],
      });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const input =
      typeof body.input === "string" ? body.input.trim() : "";
    const sessionToken =
      typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";

    if (input.length < MIN_INPUT || input.length > MAX_INPUT) {
      return NextResponse.json(
        { error: `input must be between ${MIN_INPUT} and ${MAX_INPUT} characters` },
        { status: 400 },
      );
    }
    if (sessionToken.length < 8 || sessionToken.length > 128) {
      return NextResponse.json({ error: "sessionToken is required" }, { status: 400 });
    }

    const suggestions = await fetchPlaceAutocompleteSuggestions(input, sessionToken);

    return NextResponse.json({
      ok: true,
      configured: true,
      suggestions,
    });
  } catch (e) {
    console.error("[api/places/autocomplete]", e);
    return NextResponse.json({ error: "Autocomplete failed" }, { status: 500 });
  }
}

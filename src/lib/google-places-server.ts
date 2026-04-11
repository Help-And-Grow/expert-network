import { env } from "@/lib/env";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
/** Field mask must not contain spaces (Google Places API). */
const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat";

export type PlaceAutocompleteSuggestion = {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
};

function getApiKey(): string | undefined {
  return env.GOOGLE_PLACES_API_KEY?.trim() || undefined;
}

export function isGooglePlacesConfigured(): boolean {
  return Boolean(getApiKey());
}

export function getPlacesRegionCodes(): string[] {
  const raw = env.GOOGLE_PLACES_REGION_CODES?.trim();
  if (!raw) return ["sg"];
  return raw
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length === 2);
}

type AutocompleteApiSuggestion = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
};

/**
 * Google Places API (New) — Autocomplete.
 * @see https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
 */
export async function fetchPlaceAutocompleteSuggestions(
  input: string,
  sessionToken: string,
): Promise<PlaceAutocompleteSuggestion[]> {
  const key = getApiKey();
  if (!key) return [];

  const regions = getPlacesRegionCodes();
  const body: Record<string, unknown> = {
    input,
    sessionToken,
    includedRegionCodes: regions,
    languageCode: "en",
  };

  const res = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    console.warn("[google-places] autocomplete HTTP", res.status, t.slice(0, 400));
    return [];
  }

  const data = (await res.json()) as { suggestions?: AutocompleteApiSuggestion[] };
  const list = data.suggestions ?? [];
  const out: PlaceAutocompleteSuggestion[] = [];

  for (const s of list) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    const primary = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
    const secondary = p.structuredFormat?.secondaryText?.text ?? "";
    const fullText = [primary, secondary].filter(Boolean).join(", ") || p.text?.text || primary;
    out.push({
      placeId: p.placeId,
      primaryText: primary,
      secondaryText: secondary,
      fullText,
    });
  }

  return out;
}

/**
 * Place Details (New) — formatted address for an exact location string.
 * @see https://developers.google.com/maps/documentation/places/web-service/place-details
 */
export async function fetchPlaceFormattedAddress(
  placeId: string,
  sessionToken: string,
): Promise<string | null> {
  const key = getApiKey();
  if (!key) return null;

  const id = encodeURIComponent(placeId);
  const url = new URL(`https://places.googleapis.com/v1/places/${id}`);
  url.searchParams.set("sessionToken", sessionToken);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "formattedAddress,displayName",
    },
  });

  if (!res.ok) {
    const t = await res.text();
    console.warn("[google-places] details HTTP", res.status, t.slice(0, 400));
    return null;
  }

  const data = (await res.json()) as { formattedAddress?: string; displayName?: { text?: string } };
  if (data.formattedAddress?.trim()) return data.formattedAddress.trim();
  const name = data.displayName?.text?.trim();
  return name ?? null;
}

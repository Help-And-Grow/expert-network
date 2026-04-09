/**
 * Shared Google Search grounding via Gemini AI Studio.
 *
 * Used by non-Gemini providers (Qwen, OpenAI, …) that lack native search
 * grounding. Also provides a Gemini-based PDF extraction fallback for
 * providers whose models don't support PDF input natively.
 */

import { env } from "@/lib/env";

import { createGeminiClient, getGeminiTextModel } from "./gemini-client";
import {
  buildSearchPrompt,
  formatSocialLinks,
  PDF_EXTRACTION_PROMPT,
} from "./prompts";

import type { ProfileInput } from "./types";

let _client: ReturnType<typeof createGeminiClient> | null = null;

function getClient() {
  if (_client) return _client;
  if (!env.GEMINI_API_KEY && !env.GOOGLE_CLOUD_PROJECT) return null;
  _client = createGeminiClient();
  return _client;
}

export async function searchSocialProfiles(
  data: ProfileInput
): Promise<string> {
  const gemini = getClient();
  if (!gemini) {
    return "Google Search grounding unavailable (GEMINI_API_KEY not set). Profile will be generated from the uploaded document only.";
  }

  const socialLinks = formatSocialLinks(data);
  if (!socialLinks) {
    return "No social profile links provided.";
  }

  const prompt = buildSearchPrompt(data.nickName, socialLinks);

  try {
    const response = await gemini.models.generateContent({
      model: getGeminiTextModel(),
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });

    const grounding = response.candidates?.[0]?.groundingMetadata;
    if (grounding?.webSearchQueries) {
      console.log(
        "[search] Google Search queries:",
        grounding.webSearchQueries
      );
    }

    return response.text ?? "No search results returned.";
  } catch (error) {
    console.error("[search] Gemini search failed:", error);
    return "Google Search grounding failed. Profile will be generated from the uploaded document only.";
  }
}

export async function extractPdfWithGemini(base64: string): Promise<string> {
  const gemini = getClient();
  if (!gemini) {
    throw new Error(
      "Gemini access is required for PDF extraction. Set GEMINI_API_KEY or Vertex AI credentials (GOOGLE_CLOUD_PROJECT + GOOGLE_SERVICE_ACCOUNT_KEY)."
    );
  }

  const response = await gemini.models.generateContent({
    model: getGeminiTextModel(),
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: base64 } },
          { text: PDF_EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  return response.text ?? "";
}

/**
 * Surface-aware web-search grounding for profile auto-fill.
 *
 *   Web / Telegram surfaces  →  searchSocialProfilesWithGemini
 *                                (Google Search grounding via Gemini on Vertex AI)
 *   WeChat surfaces          →  searchSocialProfilesWithHunyuan
 *                                (Tencent Hunyuan with `enable_enhancement: true`,
 *                                 which fans out to Sogou web search internally)
 *
 * Dispatch happens at the provider layer: `BaseAIProvider.generateExpertProfile`
 * uses the Gemini path; `HunyuanProvider` overrides to use the Hunyuan path so
 * WeChat traffic never crosses the GFW. See architecture.md §3.2 for the full
 * routing rationale.
 *
 * Also exposes `extractPdfWithGemini` — a Gemini-only PDF-to-text fallback for
 * providers whose models don't read PDFs natively. (Hunyuan-vision support is
 * planned but not wired yet.)
 */

import { env } from "@/lib/env";

import { createGeminiClient } from "./gemini-client";
import {
  getGeminiTextModel,
  getHunyuanTextModel,
} from "./provider-catalog";
import {
  buildSearchPrompt,
  formatSocialLinks,
  PDF_EXTRACTION_PROMPT,
} from "./prompts";

import type { ProfileInput } from "./types";

// ---------------------------------------------------------------------------
// Gemini path (Web / Telegram)
// ---------------------------------------------------------------------------

let _geminiClient: ReturnType<typeof createGeminiClient> | null = null;

function getGeminiClient() {
  if (_geminiClient) return _geminiClient;
  if (!env.GOOGLE_CLOUD_PROJECT) return null;
  _geminiClient = createGeminiClient();
  return _geminiClient;
}

export async function searchSocialProfilesWithGemini(
  data: ProfileInput,
): Promise<string> {
  const gemini = getGeminiClient();
  if (!gemini) {
    return "Google Search grounding unavailable (Vertex AI project not set). Profile will be generated from the uploaded document only.";
  }

  const socialLinks = formatSocialLinks(data);
  if (!socialLinks) {
    return "No social profile links provided.";
  }

  const prompt = buildSearchPrompt(data.nickName, socialLinks);

  try {
    const response = await gemini.models.generateContent({
      model: await getGeminiTextModel(),
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });

    const grounding = response.candidates?.[0]?.groundingMetadata;
    if (grounding?.webSearchQueries) {
      console.log(
        "[search] Google Search queries:",
        grounding.webSearchQueries,
      );
    }

    return response.text ?? "No search results returned.";
  } catch (error) {
    console.error("[search] Gemini search failed:", error);
    return "Google Search grounding failed. Profile will be generated from the uploaded document only.";
  }
}

/** @deprecated Use `searchSocialProfilesWithGemini` for explicit per-surface dispatch. */
export const searchSocialProfiles = searchSocialProfilesWithGemini;

// ---------------------------------------------------------------------------
// Hunyuan path (WeChat MP — keeps the request inside the Tencent boundary)
// ---------------------------------------------------------------------------

const HUNYUAN_CHAT_URL =
  "https://api.hunyuan.cloud.tencent.com/v1/chat/completions";

/**
 * Web-search-grounded text generation via Tencent Hunyuan.
 *
 * Implementation note: we hit the OpenAI-compatible endpoint directly via
 * `fetch` because the Tencent-specific `enable_enhancement` parameter isn't
 * part of the OpenAI SDK's typed schema. Hunyuan's response shape matches the
 * OpenAI ChatCompletions response — `choices[0].message.content` is the
 * grounded answer; citation metadata, when returned, lives on the
 * non-standard `search_info` field which we currently ignore (we're after the
 * synthesised text, not the URLs).
 *
 * Reference: https://cloud.tencent.com/document/product/1729/97732
 */
export async function searchSocialProfilesWithHunyuan(
  data: ProfileInput,
): Promise<string> {
  const apiKey = env.HUNYUAN_API_KEY;
  if (!apiKey) {
    return "Hunyuan search unavailable (HUNYUAN_API_KEY not set). Profile will be generated from the uploaded document only.";
  }

  const socialLinks = formatSocialLinks(data);
  if (!socialLinks) {
    return "No social profile links provided.";
  }

  const prompt = buildSearchPrompt(data.nickName, socialLinks);

  try {
    const response = await fetch(HUNYUAN_CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getHunyuanTextModel(),
        messages: [{ role: "user", content: prompt }],
        // Tencent-specific: turn on internal Sogou web search grounding.
        enable_enhancement: true,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Hunyuan search HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      search_info?: unknown;
    };

    if (data.search_info) {
      console.log("[search] Hunyuan grounded with web search results");
    }

    return data.choices?.[0]?.message?.content ?? "No search results returned.";
  } catch (error) {
    console.error("[search] Hunyuan search failed:", error);
    return "Hunyuan web search grounding failed. Profile will be generated from the uploaded document only.";
  }
}

// ---------------------------------------------------------------------------
// PDF extraction (Gemini-only for now — Hunyuan-vision wiring is a follow-up)
// ---------------------------------------------------------------------------

export async function extractPdfWithGemini(base64: string): Promise<string> {
  const gemini = getGeminiClient();
  if (!gemini) {
    throw new Error(
      "Gemini access is required for PDF extraction. Set Vertex AI credentials (GOOGLE_CLOUD_PROJECT + GOOGLE_SERVICE_ACCOUNT_KEY).",
    );
  }

  const response = await gemini.models.generateContent({
    model: await getGeminiTextModel(),
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

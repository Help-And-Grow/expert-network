import { Modality, ThinkingLevel } from "@google/genai";

import { env } from "@/lib/env";

import { BaseAIProvider } from "./base-provider";
import { createGeminiClient, createGeminiImageClient } from "./gemini-client";
import {
  getGeminiImageModel,
  getGeminiTextModel,
} from "./provider-catalog";
import {
  formatSocialLinks,
  buildProfilePromptWithNativeSearch,
  PDF_EXTRACTION_PROMPT,
  SYSTEM_PROMPTS,
  buildNormalizeQueryPrompt,
  buildMatchExpertsPrompt,
  buildImproveWritingPrompt,
} from "./prompts";
import {
  parseProfileResponse,
  cleanJsonResponse,
  parseMatchResponse,
} from "./types";

import type {
  ProfileInput,
  ProfileOutput,
  NormalizedQuery,
  MatchResult,
} from "./types";

/** Transient capacity / rate errors from Vertex AI — safe to retry. */
const GEMINI_CHAT_MAX_ATTEMPTS = 4;
const GEMINI_RETRY_BASE_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGeminiTransportError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /503\b|504\b|429\b|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|high demand|overloaded|temporarily unavailable|EAI_AGAIN/i.test(
      msg,
    )
  ) {
    return true;
  }
  const anyErr = err as { status?: number; code?: number; error?: { code?: number } };
  const code = anyErr?.status ?? anyErr?.code ?? anyErr?.error?.code;
  return code === 503 || code === 429 || code === 504;
}

export class GeminiProvider extends BaseAIProvider {
  private ai = createGeminiClient();
  /** Separate Vertex region when text location lacks gemini-3.1-flash-image-preview support. */
  private imageAi = createGeminiImageClient();

  constructor() {
    super();
  }

  protected async chat(
    prompt: string,
    systemInstruction?: string
  ): Promise<string> {
    const safetySettings = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { category: "HARM_CATEGORY_HATE_SPEECH" as any, threshold: "BLOCK_ONLY_HIGH" as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { category: "HARM_CATEGORY_HARASSMENT" as any, threshold: "BLOCK_ONLY_HIGH" as any },
    ] as const;

    // Gemini 2.5+ models default to a long internal "thinking" phase that
    // produces a `thoughtsTokenCount` block before the visible response. On a
    // typical Help & Grow prompt that adds ~7 s of pure latency without
    // improving the answer for our short-form use cases (intro/services copy,
    // expert matching, query normalization, admin probe). Set the budget to 0
    // to disable it everywhere — measured: 12.4 s → 5.4 s on gemini-2.5-flash.
    //
    // Older Gemini models (1.5, 2.0) silently ignore this field, so it's safe
    // to pass unconditionally. Operators who genuinely want thinking can flip
    // this back by editing this file (no env knob — reasoning is the wrong
    // default for an interactive product).
    const model = await getGeminiTextModel();
    const config: Record<string, unknown> = {
      safetySettings: [...safetySettings],
      thinkingConfig: model.startsWith("gemini-3.")
        ? { thinkingLevel: ThinkingLevel.MINIMAL }
        : { thinkingBudget: 0 },
    };
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    const genConfig = config as Parameters<
      typeof this.ai.models.generateContent
    >[0]["config"];

    for (let attempt = 0; attempt < GEMINI_CHAT_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model,
          contents: prompt,
          config: genConfig,
        });

        let text = "";
        try {
          text = response.text ?? "";
        } catch {
          const cand = response.candidates?.[0] as
            | { finishReason?: string; blockReason?: string }
            | undefined;
          const fr = cand?.finishReason ?? cand?.blockReason ?? "unknown";
          throw new Error(
            `[Gemini] Could not read response text (finishReason=${fr}).`,
          );
        }

        const finishReason = (response.candidates?.[0] as { finishReason?: string } | undefined)
          ?.finishReason;
        if (!text.trim()) {
          if (finishReason && finishReason !== "STOP") {
            throw new Error(
              `[Gemini] No output text (finishReason=${finishReason}). Try shortening or rephrasing your content.`,
            );
          }
          throw new Error(
            "[Gemini] Model returned empty text. Verify Vertex AI credentials (GOOGLE_CLOUD_PROJECT + Vertex AI API + service account).",
          );
        }
        return text;
      } catch (err) {
        const retryable =
          isRetryableGeminiTransportError(err) && attempt < GEMINI_CHAT_MAX_ATTEMPTS - 1;
        if (retryable) {
          const delay = GEMINI_RETRY_BASE_MS * 2 ** attempt;
          console.warn(
            `[Gemini] generateContent attempt ${attempt + 1}/${GEMINI_CHAT_MAX_ATTEMPTS} failed; retrying in ${delay}ms`,
            err instanceof Error ? err.message : err,
          );
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }

    throw new Error("[Gemini] generateContent exhausted retries");
  }

  /**
   * Override: single-step profile generation with native Google Search
   * grounding, avoiding the two-step search→generate flow.
   */
  async generateExpertProfile(data: ProfileInput): Promise<ProfileOutput> {
    const socialLinks = formatSocialLinks(data);
    const resumeSection = data.resumeText
      ? `\n\nAdditional context from uploaded document (resume/CV):\n${data.resumeText.slice(0, 3000)}`
      : "";

    const prompt = buildProfilePromptWithNativeSearch(
      data,
      socialLinks,
      resumeSection
    );

    const response = await this.ai.models.generateContent({
      model: await getGeminiTextModel(),
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPTS.PROFILE_BUILDER,
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        safetySettings: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { category: "HARM_CATEGORY_HATE_SPEECH" as any, threshold: "BLOCK_ONLY_HIGH" as any },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { category: "HARM_CATEGORY_HARASSMENT" as any, threshold: "BLOCK_ONLY_HIGH" as any },
        ],
      },
    });

    const grounding = response.candidates?.[0]?.groundingMetadata;
    if (grounding?.webSearchQueries) {
      console.log("[Gemini] Search queries:", grounding.webSearchQueries);
      console.log(
        "[Gemini] Grounding chunks:",
        grounding.groundingChunks?.length ?? 0
      );
    } else {
      console.warn(
        "[Gemini] No grounding metadata — Google Search may not have been used"
      );
    }

    return parseProfileResponse(response.text ?? "");
  }

  protected async generateImageRaw(prompt: string): Promise<string | null> {
    if (!env.GOOGLE_CLOUD_PROJECT) {
      console.error(
        "[Gemini] GOOGLE_CLOUD_PROJECT is not set"
      );
      return null;
    }

    try {
      // Vertex image models expect TEXT + IMAGE modalities (IMAGE-only often returns no inline image).
      const response = await this.imageAi.models.generateContent({
        model: await getGeminiImageModel(),
        contents: prompt,
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
      });

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (!parts?.length) {
        console.error(
          "[Gemini] Image response missing parts",
          JSON.stringify({
            finishReason: candidate?.finishReason,
            finishMessage: candidate?.finishMessage,
            blockReason: (candidate as { blockReason?: string }).blockReason,
          }),
        );
        return null;
      }

      for (const part of parts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || "image/png";
          return `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }
      console.error("[Gemini] Image response had no inlineData part", {
        partKinds: parts.map((p) =>
          p.inlineData ? "inlineData" : p.text ? "text" : "other",
        ),
      });
      return null;
    } catch (error) {
      console.error("[Gemini] Image generation failed:", error);
      return null;
    }
  }

  /** Override: use Gemini's own multimodal PDF capabilities directly. */
  async extractTextFromPdf(buffer: Buffer): Promise<string> {
    const base64 = buffer.toString("base64");

    const response = await this.ai.models.generateContent({
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

  async normalizeQuery(query: string): Promise<NormalizedQuery> {
    const prompt = buildNormalizeQueryPrompt(query);
    const text = await this.chat(prompt, SYSTEM_PROMPTS.QUERY_NORMALIZER);
    try {
      const parsed = JSON.parse(cleanJsonResponse(text));
      return {
        english: typeof parsed.english === "string" ? parsed.english : query,
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        intent: ["specific_topic", "broad_exploration", "greeting"].includes(
          parsed.intent
        )
          ? parsed.intent
          : "specific_topic",
        original: query,
      };
    } catch {
      return {
        english: query,
        keywords: [],
        intent: "specific_topic",
        original: query,
      };
    }
  }

  async matchExperts(
    query: string,
    expertSummaries: string,
    conversationHistory: { role: string; content: string }[],
    normalizedQuery?: NormalizedQuery
  ): Promise<MatchResult> {
    const prompt = buildMatchExpertsPrompt(
      query,
      expertSummaries,
      conversationHistory,
      normalizedQuery
    );
    const text = await this.chat(prompt, SYSTEM_PROMPTS.MATCHMAKER);
    return parseMatchResponse(text);
  }

  async improveWriting(
    type: "intro" | "services",
    content: string
  ): Promise<string> {
    const prompt = buildImproveWritingPrompt(type, content);
    return (await this.chat(prompt, SYSTEM_PROMPTS.COPYWRITER)).trim();
  }
}

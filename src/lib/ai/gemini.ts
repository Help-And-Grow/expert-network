import { Modality } from "@google/genai";

import { env } from "@/lib/env";

import { BaseAIProvider } from "./base-provider";
import {
  createGeminiClient,
  createGeminiImageClient,
  getGeminiImageModel,
  getGeminiTextModel,
} from "./gemini-client";
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


export class GeminiProvider extends BaseAIProvider {
  private ai = createGeminiClient();
  /** Separate Vertex region when text location lacks gemini-2.5-flash-image support. */
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

    const config: Record<string, unknown> = { safetySettings: [...safetySettings] };
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    const response = await this.ai.models.generateContent({
      model: getGeminiTextModel(),
      contents: prompt,
      config: config as Parameters<
        typeof this.ai.models.generateContent
      >[0]["config"],
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
        "[Gemini] Model returned empty text. Verify GEMINI_API_KEY or Vertex (GOOGLE_CLOUD_PROJECT + Vertex AI API + service account).",
      );
    }
    return text;
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
      model: getGeminiTextModel(),
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPTS.PROFILE_BUILDER,
        tools: [{ googleSearch: {} }],
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
    if (!env.GOOGLE_CLOUD_PROJECT && !env.GEMINI_API_KEY) {
      console.error(
        "[Gemini] Neither GOOGLE_CLOUD_PROJECT nor GEMINI_API_KEY is set"
      );
      return null;
    }

    try {
      // Vertex / AI Studio: image models expect TEXT + IMAGE modalities (IMAGE-only often returns no inline image).
      const response = await this.imageAi.models.generateContent({
        model: getGeminiImageModel(),
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

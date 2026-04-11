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
} from "./prompts";
import { parseProfileResponse } from "./types";

import type { ProfileInput, ProfileOutput } from "./types";


export class GeminiProvider extends BaseAIProvider {
  private ai = createGeminiClient();
  /** Separate Vertex region when text uses a region without gemini-2.5-flash-image. */
  private imageAi = createGeminiImageClient();

  constructor() {
    super();
  }

  protected async chat(prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: getGeminiTextModel(),
      contents: prompt,
    });
    return response.text ?? "";
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
      config: { tools: [{ googleSearch: {} }] },
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
}

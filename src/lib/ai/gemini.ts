import { env } from "@/lib/env";
import * as fs from "fs";

import { GoogleGenAI } from "@google/genai";

import { BaseAIProvider } from "./base-provider";
import {
  formatSocialLinks,
  buildProfilePromptWithNativeSearch,
  PDF_EXTRACTION_PROMPT,
} from "./prompts";
import { parseProfileResponse } from "./types";

import type { ProfileInput, ProfileOutput } from "./types";


const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image";

function setupServiceAccountAuth() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded || process.env.GOOGLE_APPLICATION_CREDENTIALS) return;

  const keyPath = "/tmp/gcp-sa-key.json";
  fs.writeFileSync(keyPath, Buffer.from(encoded, "base64").toString("utf-8"));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
}

function createClient(): GoogleGenAI {
  const project = env.GOOGLE_CLOUD_PROJECT;
  const location = env.GOOGLE_CLOUD_LOCATION || "us-central1";

  if (project) {
    setupServiceAccountAuth();
    console.log(
      `[Gemini] Using Vertex AI (project=${project}, location=${location})`
    );
    return new GoogleGenAI({ vertexai: true, project, location });
  }

  console.log("[Gemini] Using AI Studio API key");
  return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "" });
}

export class GeminiProvider extends BaseAIProvider {
  private ai: GoogleGenAI;

  constructor() {
    super();
    this.ai = createClient();
  }

  protected async chat(prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: TEXT_MODEL,
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
      model: TEXT_MODEL,
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
      const response = await this.ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: prompt,
        config: { responseModalities: ["IMAGE"] },
      });

      const parts = response.candidates?.[0]?.content?.parts;
      if (!parts) return null;

      for (const part of parts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || "image/png";
          return `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }
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
      model: TEXT_MODEL,
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

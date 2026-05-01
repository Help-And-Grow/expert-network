import {
  buildProfilePromptFromResearch,
  buildImagePrompt,
  buildImproveWritingPrompt,
  buildMatchExpertsPrompt,
  buildNormalizeQueryPrompt,
} from "./prompts";
import { searchSocialProfilesWithGemini, extractPdfWithGemini } from "./search";
import {
  parseProfileResponse,
  parseMatchResponse,
  cleanJsonResponse,
} from "./types";

import type {
  AIProvider,
  ProfileInput,
  ProfileOutput,
  ImageInput,
  MatchResult,
  NormalizedQuery,
} from "./types";

/**
 * Abstract base class for AI providers.
 *
 * Subclasses only need to implement two primitives — `chat` and
 * `generateImageRaw` — and get full AIProvider behaviour for free.
 *
 * Profile generation uses a two-step flow by default:
 *   1. Google Search grounding via Gemini (shared helper in search.ts)
 *   2. Text generation via the provider's own LLM
 *
 * Providers that should NOT route search through Gemini (e.g. Hunyuan, where
 * the WeChat compliance boundary requires staying inside Tencent Cloud)
 * override `generateExpertProfile` to use their own search-grounded path —
 * see `HunyuanProvider`.
 *
 * Providers with native search grounding (Gemini) can override
 * `generateExpertProfile` to collapse both steps into one call.
 */
export abstract class BaseAIProvider implements AIProvider {
  /** Send a text prompt, return the model's text response. */
  protected abstract chat(prompt: string): Promise<string>;

  /** Generate an image from a text prompt; return a data-URL or null. */
  protected abstract generateImageRaw(
    prompt: string
  ): Promise<string | null>;

  // ---------------------------------------------------------------------------
  // Default AIProvider implementations (shared logic + prompts)
  // ---------------------------------------------------------------------------

  async generateExpertProfile(data: ProfileInput): Promise<ProfileOutput> {
    const searchResults = await searchSocialProfilesWithGemini(data);
    const resumeSection = data.resumeText
      ? `\n\nUploaded document (resume/CV) — TRUSTED source:\n${data.resumeText.slice(0, 3000)}`
      : "";

    const prompt = buildProfilePromptFromResearch(
      data,
      searchResults,
      resumeSection
    );
    const text = await this.chat(prompt);
    return parseProfileResponse(text);
  }

  async generateProfileImage(data: ImageInput): Promise<string | null> {
    const prompt = buildImagePrompt(data);
    return this.generateImageRaw(prompt);
  }

  async improveWriting(
    type: "intro" | "services",
    content: string
  ): Promise<string> {
    const prompt = buildImproveWritingPrompt(type, content);
    return (await this.chat(prompt)).trim();
  }

  async normalizeQuery(query: string): Promise<NormalizedQuery> {
    const prompt = buildNormalizeQueryPrompt(query);
    const text = await this.chat(prompt);
    try {
      const parsed = JSON.parse(cleanJsonResponse(text));
      return {
        english: typeof parsed.english === "string" ? parsed.english : query,
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        intent: ["specific_topic", "broad_exploration", "greeting"].includes(parsed.intent)
          ? parsed.intent
          : "specific_topic",
        original: query,
      };
    } catch {
      console.warn("[AI] normalizeQuery parse failed, using raw query");
      return { english: query, keywords: [], intent: "specific_topic", original: query };
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
    const text = await this.chat(prompt);
    return parseMatchResponse(text);
  }

  /**
   * Default: delegate to Gemini via the shared search helper (works for
   * any provider). Providers with native multimodal PDF support can override.
   */
  async extractTextFromPdf(buffer: Buffer): Promise<string> {
    const base64 = buffer.toString("base64");
    return extractPdfWithGemini(base64);
  }
}

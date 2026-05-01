import OpenAI from "openai";

import { env } from "@/lib/env";

import { BaseAIProvider } from "./base-provider";
import { buildProfilePromptFromResearch } from "./prompts";
import { getHunyuanTextModel } from "./provider-catalog";
import { searchSocialProfilesWithHunyuan } from "./search";
import { parseProfileResponse, type ProfileInput, type ProfileOutput } from "./types";

/**
 * Tencent Hunyuan via the OpenAI-compatible endpoint:
 *   https://api.hunyuan.cloud.tencent.com/v1/chat/completions
 *
 * Auth header: `Authorization: Bearer <HUNYUAN_API_KEY>` from
 * https://console.cloud.tencent.com/cam/capi (sub-account API key with
 * Hunyuan service permissions).
 *
 * Models: hunyuan-pro / hunyuan-standard / hunyuan-lite / hunyuan-turbo /
 * hunyuan-vision. Set `HUNYUAN_TEXT_MODEL` to pin (default: hunyuan-turbo).
 *
 * Image generation lives on a separate Tencent endpoint (Hunyuan Image,
 * `hunyuanaitp.tencentcloudapi.com`) with a TC3-HMAC-SHA256 signature and is
 * not yet wired up here — image requests fall through to the next provider
 * in `IMAGE_PROVIDER_CHAIN` (Qwen / Gemini).
 */
const HUNYUAN_BASE_URL = "https://api.hunyuan.cloud.tencent.com/v1";

export class HunyuanProvider extends BaseAIProvider {
  private hunyuan: OpenAI;

  constructor() {
    super();
    const apiKey = env.HUNYUAN_API_KEY;
    if (!apiKey) console.warn("[Hunyuan] HUNYUAN_API_KEY not set");
    this.hunyuan = new OpenAI({
      apiKey: apiKey || "",
      baseURL: HUNYUAN_BASE_URL,
    });
    console.log("[AI] Using Hunyuan provider (Tencent Cloud)");
  }

  protected async chat(prompt: string): Promise<string> {
    const response = await this.hunyuan.chat.completions.create({
      model: getHunyuanTextModel(),
      messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0]?.message?.content ?? "";
  }

  /**
   * Override the default profile generation to use Hunyuan's native web
   * search (`enable_enhancement: true`) instead of routing the search
   * grounding step through Gemini. This is the WeChat compliance constraint:
   * the entire request pipeline — LLM call AND web grounding — must stay
   * inside the Tencent Cloud boundary. See architecture.md §3.2 for context.
   *
   * Same two-step shape as the base implementation; only the search engine
   * differs.
   */
  override async generateExpertProfile(
    data: ProfileInput,
  ): Promise<ProfileOutput> {
    const searchResults = await searchSocialProfilesWithHunyuan(data);
    const resumeSection = data.resumeText
      ? `\n\nUploaded document (resume/CV) — TRUSTED source:\n${data.resumeText.slice(0, 3000)}`
      : "";
    const prompt = buildProfilePromptFromResearch(
      data,
      searchResults,
      resumeSection,
    );
    const text = await this.chat(prompt);
    return parseProfileResponse(text);
  }

  /**
   * Image generation via Tencent Hunyuan Image is not yet implemented in this
   * codebase. Returning null lets `generateProfileImageResilient` fall through
   * to the next provider in `IMAGE_PROVIDER_CHAIN`.
   */
  protected async generateImageRaw(): Promise<string | null> {
    console.warn(
      "[Hunyuan] image generation not implemented — falling through to next chain provider",
    );
    return null;
  }
}

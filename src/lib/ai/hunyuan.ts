import OpenAI from "openai";

import { env } from "@/lib/env";

import { BaseAIProvider } from "./base-provider";
import { getHunyuanTextModel } from "./provider-catalog";

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

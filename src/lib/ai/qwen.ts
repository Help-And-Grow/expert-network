import { env } from "@/lib/env";
import OpenAI from "openai";

import { BaseAIProvider } from "./base-provider";
import { getQwenImageModel, getQwenTextModel } from "./provider-catalog";

const DASHSCOPE_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const DASHSCOPE_IMAGE_URL =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

export class QwenProvider extends BaseAIProvider {
  private qwen: OpenAI;

  constructor() {
    super();
    const apiKey = env.DASHSCOPE_API_KEY;
    if (!apiKey) console.warn("[Qwen] DASHSCOPE_API_KEY not set");
    this.qwen = new OpenAI({ apiKey: apiKey || "", baseURL: DASHSCOPE_BASE_URL });
    console.log("[AI] Using Qwen provider (DashScope)");
  }

  protected async chat(prompt: string): Promise<string> {
    // Qwen3 models (qwen3.x-plus, qwen3.x-35b-a3b, etc.) are reasoning models
    // that emit a long internal `reasoning_content` block before the visible
    // `content`. For all our use cases (matching, profile gen, query
    // normalization, admin probe) we want a fast direct answer rather than a
    // 15-30 s thinking phase. DashScope honours the Qwen-specific
    // `enable_thinking: false` field on the OpenAI-compatible endpoint.
    //
    // Disabling thinking brings typical latency from ~15-30 s down to ~1-3 s
    // and avoids gateway timeouts that surface as opaque "Unexpected token
    // 'A', 'An error o…'" JSON-parse errors on the admin Test now button.
    //
    // The OpenAI SDK types don't know about this field, so we cast through
    // Record<string, unknown> while preserving the non-streaming return type.
    const response = await this.qwen.chat.completions.create({
      model: getQwenTextModel(),
      messages: [{ role: "user", content: prompt }],
      ...({ enable_thinking: false } as Record<string, unknown>),
    });
    return response.choices[0]?.message?.content ?? "";
  }

  protected async generateImageRaw(prompt: string): Promise<string | null> {
    const apiKey = env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      console.error("[Qwen] DASHSCOPE_API_KEY not set");
      return null;
    }

    try {
      const res = await fetch(DASHSCOPE_IMAGE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getQwenImageModel(),
          input: {
            messages: [{ role: "user", content: [{ text: prompt }] }],
          },
          parameters: {
            size: "1K",
            n: 1,
            prompt_extend: true,
            watermark: false,
          },
        }),
      });

      if (!res.ok) {
        console.error(
          `[Qwen] Image generation failed (${res.status}): ${await res.text()}`
        );
        return null;
      }

      const result = await res.json();
      const imageUrl =
        result?.output?.choices?.[0]?.message?.content?.[0]?.image;

      if (!imageUrl) {
        console.error(
          "[Qwen] No image URL in response:",
          JSON.stringify(result).slice(0, 300)
        );
        return null;
      }

      console.log("[Qwen] Image generated, downloading...");
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok)
        throw new Error(`Failed to download image: ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const contentType = imgRes.headers.get("content-type") || "image/png";
      return `data:${contentType};base64,${buf.toString("base64")}`;
    } catch (error) {
      console.error("[Qwen] Image generation error:", error);
      return null;
    }
  }
}

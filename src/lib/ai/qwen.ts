import { env } from "@/lib/env";
import OpenAI from "openai";

import { BaseAIProvider } from "./base-provider";

const DASHSCOPE_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const DASHSCOPE_IMAGE_URL =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

const TEXT_MODEL = "qwen-max";
const IMAGE_MODEL = "qwen-image-2.0-pro";

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
    const response = await this.qwen.chat.completions.create({
      model: TEXT_MODEL,
      messages: [{ role: "user", content: prompt }],
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
          model: IMAGE_MODEL,
          input: {
            messages: [{ role: "user", content: [{ text: prompt }] }],
          },
          parameters: {
            size: "512*512",
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

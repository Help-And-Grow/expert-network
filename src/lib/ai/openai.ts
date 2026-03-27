import { env } from "@/lib/env";
import OpenAI from "openai";

import { BaseAIProvider } from "./base-provider";

const TEXT_MODEL = "gpt-4o";
const IMAGE_MODEL = "dall-e-3";

export class OpenAIProvider extends BaseAIProvider {
  private client: OpenAI;

  constructor() {
    super();
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) console.warn("[OpenAI] OPENAI_API_KEY not set");
    this.client = new OpenAI({ apiKey: apiKey || "" });
    console.log("[AI] Using OpenAI provider");
  }

  protected async chat(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: TEXT_MODEL,
      messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0]?.message?.content ?? "";
  }

  protected async generateImageRaw(prompt: string): Promise<string | null> {
    try {
      const response = await this.client.images.generate({
        model: IMAGE_MODEL,
        prompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json",
      });

      const b64 = response.data?.[0]?.b64_json;
      if (!b64) return null;
      return `data:image/png;base64,${b64}`;
    } catch (error) {
      console.error("[OpenAI] Image generation failed:", error);
      return null;
    }
  }
}

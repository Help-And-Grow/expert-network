import { env } from "@/lib/env";
import OpenAI from "openai";
import { BaseAIProvider } from "./base-provider";
import {
  getVolcengineImageModel,
  getVolcengineTextModel,
} from "./provider-catalog";

// Volcengine ModelArk — mainland China endpoint.
// Used by the Help-And-Grow build path deployed on IGA Pages CN.
const VOLCENGINE_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/";

export class VolcengineProvider extends BaseAIProvider {
  private client: OpenAI;

  constructor() {
    super();
    const apiKey = env.VOLCENGINE_API_KEY;
    if (!apiKey) console.warn("[Volcengine] VOLCENGINE_API_KEY not set");

    // Volcengine provides an OpenAI-compatible API
    this.client = new OpenAI({
      apiKey: apiKey || "",
      baseURL: VOLCENGINE_BASE_URL,
    });
    console.log("[AI] Using Volcengine provider (Doubao + Seedream)");
  }

  protected async chat(prompt: string): Promise<string> {
    // Defaults to doubao-seed-1.6-flash; override via VOLCENGINE_MODEL_ID
    // with your ModelArk endpoint id (ep-2026xxxxxx-yyyy).
    const response = await this.client.chat.completions.create({
      model: getVolcengineTextModel(),
      messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0]?.message?.content ?? "";
  }

  protected async generateImageRaw(prompt: string): Promise<string | null> {
    const apiKey = env.VOLCENGINE_API_KEY;
    if (!apiKey) {
      console.error("[Volcengine] VOLCENGINE_API_KEY not set");
      return null;
    }

    const model = getVolcengineImageModel();

    try {
      // ModelArk's OpenAI-compatible image endpoint accepts `b64_json` and
      // returns the bytes inline — avoids the extra signed-URL fetch round
      // trip that Qwen needs.
      const response = await this.client.images.generate({
        model,
        prompt,
        size: "1024x1024",
        response_format: "b64_json",
        n: 1,
      });

      const first = response.data?.[0];
      if (first?.b64_json) {
        return `data:image/png;base64,${first.b64_json}`;
      }

      // Fallback if the deployment only returns URLs (older ModelArk
      // endpoints / certain Seedream variants).
      if (first?.url) {
        console.log("[Volcengine] Seedream returned url, downloading...");
        const imgRes = await fetch(first.url);
        if (!imgRes.ok) {
          console.error(
            `[Volcengine] Failed to download image: HTTP ${imgRes.status}`,
          );
          return null;
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const contentType = imgRes.headers.get("content-type") || "image/png";
        return `data:${contentType};base64,${buf.toString("base64")}`;
      }

      console.error(
        "[Volcengine] No image data in Seedream response:",
        JSON.stringify(response).slice(0, 300),
      );
      return null;
    } catch (error) {
      console.error("[Volcengine] Image generation error:", error);
      return null;
    }
  }
}

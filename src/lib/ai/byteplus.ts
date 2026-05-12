import { env } from "@/lib/env";
import OpenAI from "openai";
import { BaseAIProvider } from "./base-provider";
import {
  getBytePlusImageModel,
  getBytePlusTextModel,
} from "./provider-catalog";

// BytePlus ModelArk — ap-southeast (Singapore) endpoint.
// Used by overseas deployments; the Volcengine counterpart at
// ark.cn-beijing.volces.com serves mainland traffic.
const BYTEPLUS_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3/";

export class BytePlusProvider extends BaseAIProvider {
  private client: OpenAI;

  constructor() {
    super();
    const apiKey = env.BYTEPLUS_API_KEY;
    if (!apiKey) console.warn("[BytePlus] BYTEPLUS_API_KEY not set");

    // BytePlus ModelArk provides an OpenAI-compatible API
    this.client = new OpenAI({
      apiKey: apiKey || "",
      baseURL: BYTEPLUS_BASE_URL,
    });
    console.log("[AI] Using BytePlus provider (Doubao + Seedream, ap-southeast)");
  }

  protected async chat(prompt: string): Promise<string> {
    // Defaults to doubao-seed-1.6-flash; override via BYTEPLUS_MODEL_ID
    // with your ModelArk endpoint id (ep-2026xxxxxx-yyyy).
    const response = await this.client.chat.completions.create({
      model: getBytePlusTextModel(),
      messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0]?.message?.content ?? "";
  }

  protected async generateImageRaw(prompt: string): Promise<string | null> {
    const apiKey = env.BYTEPLUS_API_KEY;
    if (!apiKey) {
      console.error("[BytePlus] BYTEPLUS_API_KEY not set");
      return null;
    }

    const model = getBytePlusImageModel();

    try {
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

      if (first?.url) {
        console.log("[BytePlus] Seedream returned url, downloading...");
        const imgRes = await fetch(first.url);
        if (!imgRes.ok) {
          console.error(
            `[BytePlus] Failed to download image: HTTP ${imgRes.status}`,
          );
          return null;
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const contentType = imgRes.headers.get("content-type") || "image/png";
        return `data:${contentType};base64,${buf.toString("base64")}`;
      }

      console.error(
        "[BytePlus] No image data in Seedream response:",
        JSON.stringify(response).slice(0, 300),
      );
      return null;
    } catch (error) {
      console.error("[BytePlus] Image generation error:", error);
      return null;
    }
  }
}

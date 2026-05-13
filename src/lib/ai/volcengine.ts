import { env } from "@/lib/env";
import OpenAI from "openai";
import { BaseAIProvider } from "./base-provider";
import {
  getVolcengineImageModel,
  getVolcengineTextModel,
} from "./provider-catalog";

// Volcengine ModelArk — mainland China endpoint. Used by the
// jlzxwt8/expert-network IGA Pages CN production deploy (post company-setup
// + ICP filing). The overseas/demo counterpart hits ByteDance's ap-southeast
// endpoint via src/lib/ai/byteplus.ts.
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
    // with your activated ModelArk model name (e.g.
    // doubao-seed-2-0-mini-260428) or endpoint id (ep-2026xxxxxx-yyyy).
    const model = getVolcengineTextModel();
    const startedAt = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.choices[0]?.message?.content ?? "";
      if (!text) {
        console.warn("[Volcengine] empty content", {
          model,
          elapsedMs: Date.now() - startedAt,
          finishReason: response.choices[0]?.finish_reason,
        });
      }
      return text;
    } catch (err) {
      // The OpenAI SDK swallows the raw response body when it can't be parsed
      // as JSON ("Unexpected token 'A', ... is not valid JSON") — log every
      // error field so production logs surface the actual upstream cause
      // (auth, rate, model-not-activated, gateway).
      const detail =
        err instanceof Error
          ? {
              name: err.name,
              message: err.message,
              status: (err as { status?: number }).status,
              code: (err as { code?: string }).code,
              type: (err as { type?: string }).type,
            }
          : { message: String(err) };
      console.error("[Volcengine] chat failed", {
        ...detail,
        model,
        baseURL: VOLCENGINE_BASE_URL,
        elapsedMs: Date.now() - startedAt,
      });
      throw err;
    }
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

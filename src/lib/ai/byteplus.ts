import { env } from "@/lib/env";
import OpenAI from "openai";
import { BaseAIProvider } from "./base-provider";
import {
  getBytePlusImageModel,
  getBytePlusTextModel,
} from "./provider-catalog";

// BytePlus ModelArk — ap-southeast (Singapore) endpoint. Used by the
// Help-And-Grow/expert-network demo mirror for hackathon / investor /
// credit-grant showcases of the ByteDance integration. The mainland CN
// production counterpart at ark.cn-beijing.volces.com is in
// src/lib/ai/volcengine.ts.
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
    // with your activated BytePlus model name or endpoint id.
    //
    // Doubao Seed 2.0+ models default to a long "thinking" phase that adds
    // 10-20 s of latency before the visible content. The model.chat path
    // never needs that for our short-form prompts (intro copy, services
    // copy, matching, query normalization, probe). BytePlus / Volcengine ARK
    // accepts the official `thinking: { type: "disabled" }` parameter to
    // suppress it — same pattern as Qwen3's `enable_thinking: false` and
    // Gemini 2.5's `thinkingConfig: { thinkingBudget: 0 }`. We also include
    // `enable_thinking: false` as a backward-compat field name; older Seed
    // models honour that and newer ones ignore unknown fields.
    //
    // Cast through Record<string, unknown> because neither field is in the
    // OpenAI SDK types; the SDK passes unknown fields through to the body.
    const model = getBytePlusTextModel();
    const startedAt = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        ...({
          thinking: { type: "disabled" },
          enable_thinking: false,
        } as Record<string, unknown>),
      });
      const text = response.choices[0]?.message?.content ?? "";
      if (!text) {
        console.warn("[BytePlus] empty content", {
          model,
          elapsedMs: Date.now() - startedAt,
          finishReason: response.choices[0]?.finish_reason,
        });
      }
      return text;
    } catch (err) {
      // Surface raw error fields — the OpenAI SDK obscures non-JSON upstream
      // bodies behind an opaque JSON-parse error.
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
      console.error("[BytePlus] chat failed", {
        ...detail,
        model,
        baseURL: BYTEPLUS_BASE_URL,
        elapsedMs: Date.now() - startedAt,
      });
      throw err;
    }
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

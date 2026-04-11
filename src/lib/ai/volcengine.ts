import { env } from "@/lib/env";
import OpenAI from "openai";
import { BaseAIProvider } from "./base-provider";

// Volcengine uses the mainland China endpoint
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
      baseURL: VOLCENGINE_BASE_URL 
    });
    console.log("[AI] Using Volcengine provider (Doubao ModelArk)");
  }

  protected async chat(prompt: string): Promise<string> {
    // Defaulting to doubao-seed-1.6-flash for text understanding and generation 
    const modelId = env.VOLCENGINE_MODEL_ID || "doubao-seed-1.6-flash";
    
    const response = await this.client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0]?.message?.content ?? "";
  }

  protected async generateImageRaw(_prompt: string): Promise<string | null> {
    console.warn("[Volcengine] Image generation is currently not supported via the standard chat interface. Please configure a dedicated vision model endpoint.");
    return null;
  }
}

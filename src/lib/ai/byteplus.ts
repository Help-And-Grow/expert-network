import { env } from "@/lib/env";
import OpenAI from "openai";
import { BaseAIProvider } from "./base-provider";

// BytePlus ModelArk uses the ap-southeast endpoint for the Singapore region
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
      baseURL: BYTEPLUS_BASE_URL 
    });
    console.log("[AI] Using BytePlus provider (ModelArk / Coze API Stack)");
  }

  protected async chat(prompt: string): Promise<string> {
    // Requires an Endpoint ID (or Model ID) from the BytePlus ModelArk console
    // e.g., ep-2026xxxxxx-yyyyy
    const modelId = env.BYTEPLUS_MODEL_ID || "doubao-pro-32k";
    
    const response = await this.client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0]?.message?.content ?? "";
  }

  protected async generateImageRaw(_prompt: string): Promise<string | null> {
    console.warn("[BytePlus] Image generation is currently not supported via the standard chat interface. Please configure a dedicated vision model endpoint.");
    return null;
  }
}

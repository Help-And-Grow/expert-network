import { env } from "@/lib/env";
import {
  getGoogleAccessToken,
  hasGoogleServiceAccountConfig,
} from "@/lib/google-access-token";

import { BaseAIProvider } from "./base-provider";
import {
  createGeminiClient,
} from "./gemini-client";
import {
  getGeminiImageModel,
  getZAIImageModel,
  getZAITextModel,
  getZAIVertexTextModel,
} from "./provider-catalog";

const DEFAULT_ZAI_BASE_URL = "https://api.z.ai/api/paas/v4/";
const DEFAULT_ZAI_VERTEX_LOCATION = "global";

function getBaseUrl(): string {
  const raw = env.ZAI_BASE_URL?.trim() || DEFAULT_ZAI_BASE_URL;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function getTextModel(): string {
  if (shouldUseVertexZAI()) {
    return getZAIVertexTextModel();
  }
  return getZAITextModel();
}

function getVertexLocation(): string {
  return env.ZAI_VERTEX_LOCATION?.trim() || DEFAULT_ZAI_VERTEX_LOCATION;
}

function getImageModel(): string {
  return getZAIImageModel();
}

function shouldUseVertexZAI(): boolean {
  return Boolean(env.GOOGLE_CLOUD_PROJECT && hasGoogleServiceAccountConfig());
}

type OpenAICompatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
};

export class ZAIProvider extends BaseAIProvider {
  constructor() {
    super();
    if (shouldUseVertexZAI()) {
      console.log(
        `[AI] Using Z.AI provider via Vertex AI (project=${env.GOOGLE_CLOUD_PROJECT}, location=${getVertexLocation()}, model=${getTextModel()})`,
      );
    } else {
      if (!env.ZAI_API_KEY) console.warn("[Z.AI] ZAI_API_KEY not set");
      console.log("[AI] Using direct Z.AI API provider");
    }
  }

  private async createVertexHeaders(): Promise<HeadersInit> {
    const token = await getGoogleAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "x-goog-user-project": env.GOOGLE_CLOUD_PROJECT || "",
    };
  }

  private async vertexChat(prompt: string): Promise<string> {
    const project = env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      throw new Error("GOOGLE_CLOUD_PROJECT is required for Vertex-hosted Z.AI");
    }

    const response = await fetch(
      `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(getVertexLocation())}/endpoints/openapi/chat/completions`,
      {
        method: "POST",
        headers: await this.createVertexHeaders(),
        body: JSON.stringify({
          model: `zai-org/${getTextModel()}`,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096,
          temperature: 0.2,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Vertex Z.AI chat failed (${response.status}): ${text.slice(0, 400)}`);
    }

    const data = (await response.json()) as OpenAICompatResponse;
    const message = data.choices?.[0]?.message;
    return message?.content ?? message?.reasoning_content ?? "";
  }

  private async directChat(prompt: string): Promise<string> {
    const response = await fetch(new URL("chat/completions", getBaseUrl()), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ZAI_API_KEY || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getTextModel(),
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Z.AI chat failed (${response.status}): ${text.slice(0, 400)}`);
    }

    const data = (await response.json()) as OpenAICompatResponse;
    const message = data.choices?.[0]?.message;
    return message?.content ?? message?.reasoning_content ?? "";
  }

  protected async chat(prompt: string): Promise<string> {
    if (shouldUseVertexZAI()) {
      return this.vertexChat(prompt);
    }

    return this.directChat(prompt);
  }

  protected async generateImageRaw(prompt: string): Promise<string | null> {
    if (shouldUseVertexZAI()) {
      try {
        const gemini = createGeminiClient();
        const response = await gemini.models.generateContent({
          model: await getGeminiImageModel(),
          contents: prompt,
          config: { responseModalities: ["IMAGE"] },
        });

        const parts = response.candidates?.[0]?.content?.parts;
        if (!parts) return null;

        for (const part of parts) {
          if (part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType || "image/png";
            return `data:${mimeType};base64,${part.inlineData.data}`;
          }
        }
      } catch (error) {
        console.error("[Z.AI] Vertex image fallback failed:", error);
      }
      return null;
    }

    try {
      const res = await fetch(new URL("images/generations", getBaseUrl()), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.ZAI_API_KEY || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getImageModel(),
          prompt,
          size: "1024x1024",
          response_format: "b64_json",
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Z.AI image generation failed (${res.status}): ${text.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const item = data.data?.[0];
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;

      if (item?.url) {
        const imageRes = await fetch(item.url);
        if (!imageRes.ok) return null;
        const buffer = Buffer.from(await imageRes.arrayBuffer());
        return `data:image/png;base64,${buffer.toString("base64")}`;
      }

      return null;
    } catch (error) {
      console.error("[Z.AI] Image generation failed:", error);
      return null;
    }
  }
}

import { env } from "@/lib/env";
import type {
  AIProvider,
  ImageInput,
  MatchResult,
  ProfileInput,
  ProfileOutput,
} from "./types";
import { parseMatchResponse, parseProfileResponse } from "./types";

const API_BASE = "https://api.dedaluslabs.ai/v1";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function chat(
  messages: ChatMessage[],
  model?: string
): Promise<string> {
  const apiKey = env.DEDALUS_API_KEY;
  if (!apiKey) throw new Error("DEDALUS_API_KEY is not set");

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || env.DEDALUS_MODEL || "google/gemini-2.5-flash",
      messages,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[dedalus] API error:", res.status, err);
    throw new Error(`Dedalus API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export class DedalusProvider implements AIProvider {
  async generateExpertProfile(data: ProfileInput): Promise<ProfileOutput> {
    const sources = [
      data.linkedIn && `LinkedIn: ${data.linkedIn}`,
      data.website && `Website: ${data.website}`,
      data.twitter && `Twitter: ${data.twitter}`,
      data.substack && `Substack: ${data.substack}`,
      data.instagram && `Instagram: ${data.instagram}`,
      data.xiaohongshu && `Xiaohongshu: ${data.xiaohongshu}`,
      data.resumeText && `Resume:\n${data.resumeText}`,
    ]
      .filter(Boolean)
      .join("\n");

    const text = await chat([
      {
        role: "system",
        content: `You are an expert profile writer for a professional networking platform.
Return ONLY a valid JSON object with these fields:
- bio: A compelling 2-3 paragraph professional bio (string)
- services: Array of {title, description} objects (3-5 services the expert can offer)
- videoScript: A 60-second introduction script for the expert
- sourceSummary: Brief summary of what you found from their profiles`,
      },
      {
        role: "user",
        content: `Create a professional profile for ${data.nickName}.
Domains: ${data.domains.join(", ")}

Sources:
${sources || "No external sources provided."}`,
      },
    ]);

    return parseProfileResponse(text);
  }

  async generateProfileImage(data: ImageInput): Promise<string | null> {
    try {
      const apiKey = env.DEDALUS_API_KEY;
      if (!apiKey) return null;

      const res = await fetch(`${API_BASE}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/dall-e-3",
          prompt: `Professional avatar illustration for ${data.nickName}, a ${data.domains.join("/")} expert. ${data.gender || ""}. Modern, clean, friendly style with a subtle gradient background. No text.`,
          n: 1,
          size: "1024x1024",
        }),
      });

      if (!res.ok) return null;
      const result = await res.json();
      return result.data?.[0]?.url ?? null;
    } catch (err) {
      console.error("[dedalus] Image generation failed:", err);
      return null;
    }
  }

  async improveWriting(
    type: "intro" | "services",
    content: string
  ): Promise<string> {
    const text = await chat([
      {
        role: "system",
        content:
          type === "intro"
            ? "Improve this professional bio. Keep the same meaning but make it more engaging, clear, and well-structured. Return only the improved text."
            : "Improve this service description. Make it clearer and more compelling. Return only the improved text.",
      },
      { role: "user", content },
    ]);
    return text;
  }

  async matchExperts(
    query: string,
    expertSummaries: string,
    conversationHistory: { role: string; content: string }[]
  ): Promise<MatchResult> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are an expert matching assistant. Given the user's query and available experts, recommend the best matches.

Available experts:
${expertSummaries}

Return ONLY a valid JSON object:
{
  "recommendations": [
    { "expertId": "...", "name": "...", "reason": "...", "sessionTypes": ["ONLINE"|"OFFLINE"] }
  ],
  "noMatchMessage": "..." // only if no good matches found
}`,
      },
      ...conversationHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: query },
    ];

    const text = await chat(
      messages,
      env.DEDALUS_MATCH_MODEL || "anthropic/claude-sonnet-4-5-20250929"
    );
    return parseMatchResponse(text);
  }

  async extractTextFromPdf(buffer: Buffer): Promise<string> {
    const apiKey = env.DEDALUS_API_KEY;
    if (!apiKey) throw new Error("DEDALUS_API_KEY is not set");

    try {
      const res = await fetch(`${API_BASE.replace("/v1", "")}/v1/ocr`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document: {
            type: "base64",
            data: buffer.toString("base64"),
            media_type: "application/pdf",
          },
        }),
      });

      if (!res.ok) {
        console.warn("[dedalus] OCR failed, falling back to chat extraction");
        return this.extractTextViaChatFallback(buffer);
      }

      const data = await res.json();
      return data.text || data.content || "";
    } catch {
      return this.extractTextViaChatFallback(buffer);
    }
  }

  private async extractTextViaChatFallback(buffer: Buffer): Promise<string> {
    const base64 = buffer.toString("base64");
    const text = await chat(
      [
        {
          role: "system",
          content:
            "Extract all text content from this document. Return the text only.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all text from this PDF:" },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64}`,
              },
            },
          ] as unknown as string,
        },
      ],
      "google/gemini-2.5-flash"
    );
    return text;
  }
}

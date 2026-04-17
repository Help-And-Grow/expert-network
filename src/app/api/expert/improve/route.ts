import { type NextRequest, NextResponse } from "next/server";

import { improveWriting } from "@/lib/ai";
import { env } from "@/lib/env";
import { resolveUserId } from "@/lib/request-auth";

function clientSafeDetail(message: string, max = 450): string {
  return message
    .replace(/\bAIza[\w-]{20,}\b/g, "[key]")
    .replace(/\bsk_live_[\w]{20,}\b/gi, "[key]")
    .replace(/\bsk_test_[\w]{20,}\b/gi, "[key]")
    .slice(0, max);
}

async function improveWritingResilient(
  type: "intro" | "services",
  content: string,
): Promise<string> {
  try {
    return await improveWriting(type, content);
  } catch (primaryError) {
    const hasGeminiFallback =
      Boolean(env.GEMINI_API_KEY?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim()) &&
      (env.AI_PROVIDER || "qwen") !== "gemini";

    if (!hasGeminiFallback) {
      throw primaryError;
    }

    try {
      const { GeminiProvider } = await import("@/lib/ai/gemini");
      return await new GeminiProvider().improveWriting(type, content);
    } catch {
      throw primaryError;
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { type, content } = body;

    if (type !== "intro" && type !== "services") {
      return NextResponse.json(
        { error: "Invalid type. Must be 'intro' or 'services'." },
        { status: 400 }
      );
    }

    if (!content || (typeof content === "string" && !content.trim())) {
      return NextResponse.json(
        { error: "Content is required." },
        { status: 400 }
      );
    }

    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    const improved = await improveWritingResilient(type, contentStr);
    const trimmed = improved.trim();

    if (type === "intro" && !trimmed) {
      return NextResponse.json(
        {
          error:
            "The AI returned no text (often safety filters or an empty model response). Try editing the script and try again.",
        },
        { status: 422 },
      );
    }

    if (type === "services") {
      const cleaned = trimmed.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return NextResponse.json({ improved: JSON.parse(jsonMatch[0]) });
      }
      return NextResponse.json(
        { error: "AI returned invalid format. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ improved: trimmed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[expert/improve POST]", message, error);

    const isRateLimit =
      (error as { status?: number })?.status === 429 ||
      message.includes("RESOURCE_EXHAUSTED") ||
      message.includes("quota");

    const isModelUnavailable =
      message.includes("UNAVAILABLE") ||
      message.includes("high demand") ||
      message.includes('"code":503') ||
      message.includes('"status":"UNAVAILABLE"') ||
      /\b503\b/.test(message);

    const detail = clientSafeDetail(message);
    if (isModelUnavailable) {
      return NextResponse.json(
        {
          error:
            "Google's AI is temporarily overloaded. Wait a minute and try again, or try outside peak hours.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        error: isRateLimit
          ? "AI quota exceeded. Please try again later."
          : `Failed to improve content. Please try again.`,
        detail,
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}

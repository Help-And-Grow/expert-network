import { type NextRequest, NextResponse } from "next/server";

import { chat, type ChatMessage } from "@/lib/chat-engine";

/**
 * Platform-agnostic conversational API for expert recommendations.
 *
 * POST /api/chat
 * Body: { message: string, history?: ChatMessage[], platform?: string }
 * Returns: { reply: string, experts: ExpertRecommendation[] }
 *
 * Designed for integration with Telegram, WeChat, WhatsApp, or any client.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const message =
      typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const history: ChatMessage[] = Array.isArray(body.history)
      ? body.history.filter(
          (m: unknown) =>
            typeof m === "object" &&
            m !== null &&
            typeof (m as ChatMessage).role === "string" &&
            typeof (m as ChatMessage).content === "string"
        )
      : [];

    const platform = typeof body.platform === "string" ? body.platform : undefined;

    const result = await chat(message, history, platform, { request });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[chat POST]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

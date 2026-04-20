import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { transcribeDashScopeAsr } from "@/lib/dashscope-asr";

/**
 * POST /api/speech-to-text
 *
 * Accepts an audio file (FormData with field "audio") and returns
 * the transcribed text using Qwen3-ASR-Flash via DashScope.
 */
export async function POST(request: NextRequest) {
  try {
    if (!env.DASHSCOPE_API_KEY?.trim()) {
      return NextResponse.json(
        { error: "Speech recognition is not configured" },
        { status: 503 },
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio");
    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
    }

    const arrayBuf = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuf).toString("base64");
    const mimeType = audioFile.type || "audio/webm";

    const text = await transcribeDashScopeAsr(base64Audio, mimeType);
    return NextResponse.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[speech-to-text POST]", message, error);
    const status = message.includes("DashScope ASR failed") ? 502 : 500;
    return NextResponse.json(
      { error: status === 502 ? "Speech recognition failed" : "Internal server error", detail: message },
      { status },
    );
  }
}

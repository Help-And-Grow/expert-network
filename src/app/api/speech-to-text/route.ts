import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

const DASHSCOPE_URL =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const ASR_MODEL = "qwen3-asr-flash";

/**
 * POST /api/speech-to-text
 *
 * Accepts an audio file (FormData with field "audio") and returns
 * the transcribed text using Qwen3-ASR-Flash via DashScope.
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Speech recognition is not configured" },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio");
    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 }
      );
    }

    const arrayBuf = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuf).toString("base64");
    const mimeType = audioFile.type || "audio/webm";
    const dataUri = `data:${mimeType};base64,${base64Audio}`;

    const res = await fetch(DASHSCOPE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ASR_MODEL,
        input: {
          messages: [
            { role: "system", content: [{ text: "" }] },
            { role: "user", content: [{ audio: dataUri }] },
          ],
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[speech-to-text]", res.status, errText.slice(0, 500));
      return NextResponse.json(
        { error: "Speech recognition failed", detail: errText.slice(0, 200) },
        { status: 502 }
      );
    }

    const data = await res.json();

    const text =
      data?.output?.choices?.[0]?.message?.content?.[0]?.text ??
      data?.output?.text ??
      "";

    return NextResponse.json({ text: text.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[speech-to-text POST]", message, error);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 }
    );
  }
}

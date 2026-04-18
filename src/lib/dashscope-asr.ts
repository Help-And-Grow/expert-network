import { env } from "@/lib/env";

const DASHSCOPE_URL =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const ASR_MODEL = "qwen3-asr-flash";

/**
 * Transcribe raw audio (base64 + MIME) with Qwen3-ASR-Flash on DashScope.
 * Same contract as POST /api/speech-to-text.
 */
export async function transcribeDashScopeAsr(
  audioBase64: string,
  mimeType: string,
): Promise<string> {
  const apiKey = env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("DASHSCOPE_API_KEY is not set for DashScope speech recognition.");
  }

  const normalizedMime =
    mimeType?.toLowerCase().split(";")[0]?.trim() || "audio/webm";
  const dataUri = `data:${normalizedMime};base64,${audioBase64}`;

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
    throw new Error(
      `DashScope ASR failed (${res.status}): ${errText.slice(0, 500)}`,
    );
  }

  const data = await res.json();
  const text =
    data?.output?.choices?.[0]?.message?.content?.[0]?.text ??
    data?.output?.text ??
    "";

  return String(text).trim();
}

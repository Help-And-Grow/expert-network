import OpenAI from "openai";

const dashscope = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || "",
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
});

const DEFAULT_MIN_SCORE = Number(process.env.EVALUATOR_MIN_SCORE || 7);

async function fetchExternalToolContext(draft) {
  const url = process.env.HICLAW_EVALUATOR_TOOL_URL;
  if (!url) return "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    });
    if (!res.ok) return "";
    const data = await res.json().catch(() => ({}));
    if (typeof data.hint === "string" && data.hint.trim()) {
      return `\n\nTool / system checks (from HICLAW_EVALUATOR_TOOL_URL):\n---\n${data.hint.trim()}\n---`;
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Skeptical quality pass on a shadow draft before it enters the waiting room
 * (mentee-facing pipeline / expert review).
 *
 * @returns {{ pass: boolean, overallScore: number, scores: object, critique: string }}
 */
export async function evaluateDraft({
  draft,
  expertName,
  menteeQuery,
  mem9Context,
  sprintContract = null,
  minScore = DEFAULT_MIN_SCORE,
}) {
  const system = `You are an independent quality evaluator for the Help & Grow expert network.
The Generator drafted a reply that will be shown to a mentee (and later may reach Telegram/WeChat).
You must be strict and specific. Output ONLY valid JSON with this shape:
{"overallScore": number from 1-10, "brandVoice": number 1-10, "actionability": number 1-10, "empathy": number 1-10, "pass": boolean, "critique": string}

Scoring rubric:
- brandVoice: Does it sound like ${expertName} (per the persona notes) vs generic AI assistant?
- actionability: Concrete steps vs vague platitudes?
- empathy: Appropriate tone for likely anxiety/uncertainty in the mentee question?

pass should be true only if overallScore >= ${minScore} and no criterion is below 5.`;

  const contractBlock = sprintContract
    ? `\n\nSprint / vetting contract for this turn:\n---\n${sprintContract}\n---`
    : "";
  const toolBlock = await fetchExternalToolContext(draft);
  const user = `Mentee question:\n---\n${menteeQuery}\n---\n\nPersona / memory notes about ${expertName}:\n---\n${mem9Context || "(none)"}\n---${contractBlock}${toolBlock}\n\nDraft reply:\n---\n${draft}\n---`;

  const completionParams = {
    model: "qwen-max",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: 800,
  };

  let response;
  try {
    response = await dashscope.chat.completions.create({
      ...completionParams,
      response_format: { type: "json_object" },
    });
  } catch {
    response = await dashscope.chat.completions.create(completionParams);
  }

  let raw = response.choices[0]?.message?.content ?? "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) raw = jsonMatch[0];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      pass: false,
      overallScore: 0,
      scores: {},
      critique: "Evaluator returned invalid JSON; treat as fail.",
    };
  }

  const overallScore = Number(parsed.overallScore) || 0;
  const scores = {
    brandVoice: Number(parsed.brandVoice) || 0,
    actionability: Number(parsed.actionability) || 0,
    empathy: Number(parsed.empathy) || 0,
  };
  const pass =
    typeof parsed.pass === "boolean"
      ? parsed.pass
      : overallScore >= minScore &&
        scores.brandVoice >= 5 &&
        scores.actionability >= 5 &&
        scores.empathy >= 5;

  return {
    pass,
    overallScore,
    scores,
    critique: typeof parsed.critique === "string" ? parsed.critique : "",
  };
}

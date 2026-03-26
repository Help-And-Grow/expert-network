import OpenAI from "openai";

const dashscope = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || "",
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
});

/**
 * Draft a one-turn sprint / vetting contract so generator and evaluator share explicit success criteria.
 * @param {"vetting"|"coaching"} mode
 */
export async function proposeSprintContract({
  expertName,
  mem9Context,
  menteeQuery,
  mode = "vetting",
}) {
  const modeHint =
    mode === "coaching"
      ? "Internal coaching: agree what the expert should produce this session (e.g. productize a tactic into a repeatable service)."
      : "External vetting: e.g. answer the founder's first questions and capture key qualification facts before suggesting a meeting.";

  const system = `You are a planner for Help & Grow. ${modeHint}
Output 3-6 bullet points: concrete success criteria for THIS single reply only. No JSON; plain text bullets.`;

  const user = `Expert: ${expertName}\n\nPersona notes:\n---\n${mem9Context || "(none)"}\n---\n\nMentee / expert message:\n---\n${menteeQuery}\n---`;

  const response = await dashscope.chat.completions.create({
    model: "qwen-max",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
    max_tokens: 500,
  });

  return (response.choices[0]?.message?.content ?? "").trim();
}

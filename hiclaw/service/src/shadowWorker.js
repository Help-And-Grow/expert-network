import OpenAI from "openai";
import { getExpertContext } from "./mem9Client.js";

const dashscope = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || "",
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
});

const CONTEXT_WINDOW = Number(process.env.SHADOW_CONTEXT_WINDOW_TOKENS || 32768);
const RESET_RATIO = Number(process.env.SHADOW_CONTEXT_RESET_RATIO || 0.7);
const MAX_OUTPUT_TOKENS = Number(process.env.SHADOW_MAX_TOKENS || 1024);

/** Rough token estimate (mixed CJK / Latin). */
export function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/g) || []).length;
  const other = Math.max(0, text.length - cjk);
  return Math.ceil(cjk * 1.2 + other / 4);
}

function estimateMessagesTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content || ""), 0);
}

function buildSystemPrompt(expertName, context, mem9ProfileSummary, sprintContract) {
  const contextBlock = context
    ? `\n\nHere is background knowledge about ${expertName} from their memory:\n---\n${context}\n---`
    : "";
  const profileBlock = mem9ProfileSummary
    ? `\n\nStanding profile summary (for continuity):\n---\n${mem9ProfileSummary}\n---`
    : "";
  const contractBlock = sprintContract
    ? `\n\nSprint contract for this turn (stay within these bounds):\n---\n${sprintContract}\n---`
    : "";

  return `You are a shadow assistant for ${expertName}, an expert on the Help & Grow platform (AI Native Expert Network).
Your job is to draft a helpful response in ${expertName}'s style and voice.
The expert is currently offline — your draft will be reviewed by them before being sent.

Guidelines:
- Be professional, specific, and actionable
- Draw on the expert's known background and expertise
- If you're unsure about something, say "I'd recommend confirming with me directly"
- Keep responses concise (2-4 paragraphs)
- Write in first person as if you are the expert${contextBlock}${profileBlock}${contractBlock}`;
}

/**
 * Structured handoff when context is too large (persisted on session row).
 */
export async function generateHandoffArtifact({ expertName, dialogueMessages }) {
  const transcript = dialogueMessages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const system = `You compress a mentoring chat into a structured handoff for a fresh model context.
Output valid JSON only with keys:
goal (string), progress (string), userTemperament (string), agreedNextStep (string), openRisks (string).`;

  const user = `Expert: ${expertName}\n\nTranscript:\n---\n${transcript}\n---`;

  let raw;
  try {
    const response = await dashscope.chat.completions.create({
      model: "qwen-max",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 900,
      response_format: { type: "json_object" },
    });
    raw = response.choices[0]?.message?.content ?? "{}";
  } catch {
    const response = await dashscope.chat.completions.create({
      model: "qwen-max",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 900,
    });
    raw = response.choices[0]?.message?.content ?? "{}";
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) raw = jsonMatch[0];
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return JSON.stringify({
      goal: "",
      progress: transcript.slice(0, 2000),
      userTemperament: "",
      agreedNextStep: "",
      openRisks: "",
    });
  }
}

async function completionFromMessages(messages) {
  const response = await dashscope.chat.completions.create({
    model: "qwen-max",
    messages,
    temperature: 0.7,
    max_tokens: MAX_OUTPUT_TOKENS,
  });
  return response.choices[0]?.message?.content ?? "";
}

/**
 * @param {object} opts
 * @param {string} [opts.evaluatorCritique]
 * @param {string} [opts.priorDraftForRefinement]
 * @param {Array<{role:string,content:string}>} [opts.priorMessages] user/assistant only (no system)
 * @param {string} [opts.handoffArtifact] persisted JSON text
 * @param {(artifact: string, replacementMessages: object[]) => Promise<void>} [opts.onContextReset]
 */
export async function generate({
  expertId,
  mem9SpaceId,
  expertName,
  query,
  mem9Context: mem9ContextOverride,
  mem9ProfileSummary = "",
  sprintContract = null,
  priorMessages = [],
  handoffArtifact = null,
  evaluatorCritique = null,
  priorDraftForRefinement = null,
  onContextReset = null,
}) {
  let mem9Context = mem9ContextOverride;
  if (mem9Context === undefined && mem9SpaceId) {
    try {
      mem9Context = await getExpertContext(mem9SpaceId, query);
    } catch (err) {
      console.error(`[ShadowWorker] mem9 fetch failed for ${expertId}:`, err);
      mem9Context = "";
    }
  } else if (mem9Context === undefined) {
    mem9Context = "";
  }

  let systemPrompt = buildSystemPrompt(expertName, mem9Context, mem9ProfileSummary, sprintContract);
  if (evaluatorCritique) {
    systemPrompt += "\n\nAddress the evaluator feedback while staying in the expert's authentic voice.";
  }

  let history = [...priorMessages];
  if (history.length && history[history.length - 1].role === "user") {
    history = history.slice(0, -1);
  }

  let tailUser;
  if (evaluatorCritique && priorDraftForRefinement) {
    tailUser = `Your previous draft:\n---\n${priorDraftForRefinement}\n---\n\nEvaluator critique:\n---\n${evaluatorCritique}\n---\n\nMentee question:\n${query}`;
  } else if (handoffArtifact) {
    tailUser = `Prior session handoff:\n---\n${handoffArtifact}\n---\n\nMentee message:\n${query}`;
  } else {
    tailUser = query;
  }

  let messages = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: tailUser },
  ];

  const threshold = CONTEXT_WINDOW * RESET_RATIO;
  let promptTokens = estimateMessagesTokens(messages);
  if (promptTokens > threshold && onContextReset) {
    const artifact = await generateHandoffArtifact({
      expertName,
      dialogueMessages: messages.filter((m) => m.role !== "system"),
    });
    const replacement = [
      {
        role: "user",
        content: `Session handoff (synthesized):\n${artifact}\n\n---\nLatest mentee message:\n${query}`,
      },
    ];
    await onContextReset(artifact, replacement);
    messages = [
      {
        role: "system",
        content: buildSystemPrompt(expertName, mem9Context, mem9ProfileSummary, sprintContract),
      },
      ...replacement,
    ];
    promptTokens = estimateMessagesTokens(messages);
  }

  if (promptTokens > threshold) {
    console.warn(
      `[ShadowWorker] Prompt still ~${promptTokens} tokens after reset (threshold ${threshold}); generating anyway.`
    );
  }

  return completionFromMessages(messages);
}

export async function refineDraft({
  expertId,
  mem9SpaceId,
  expertName,
  menteeQuery,
  priorDraft,
  critique,
  mem9Context,
  mem9ProfileSummary = "",
  sprintContract = null,
  priorMessages = [],
  handoffArtifact = null,
}) {
  return generate({
    expertId,
    mem9SpaceId,
    expertName,
    query: menteeQuery,
    mem9Context,
    mem9ProfileSummary,
    sprintContract,
    priorMessages,
    handoffArtifact,
    evaluatorCritique: critique,
    priorDraftForRefinement: priorDraft,
  });
}

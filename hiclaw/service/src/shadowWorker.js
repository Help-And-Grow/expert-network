import OpenAI from "openai";
import { getExpertContext } from "./mem9Client.js";

const dashscope = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || "",
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
});

/**
 * Generate a draft response on behalf of an offline expert.
 * Pulls mem9 context scoped to the expert's space, then calls
 * DashScope Qwen-Max to produce a styled reply.
 */
export async function generate({ expertId, mem9SpaceId, expertName, query }) {
  let context = "";
  if (mem9SpaceId) {
    try {
      context = await getExpertContext(mem9SpaceId, query);
    } catch (err) {
      console.error(`[ShadowWorker] mem9 fetch failed for ${expertId}:`, err);
    }
  }

  const systemPrompt = buildSystemPrompt(expertName, context);

  const response = await dashscope.chat.completions.create({
    model: "qwen-max",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
    temperature: 0.7,
    max_tokens: 1024,
  });

  return response.choices[0]?.message?.content ?? "";
}

function buildSystemPrompt(expertName, context) {
  const contextBlock = context
    ? `\n\nHere is background knowledge about ${expertName} from their memory:\n---\n${context}\n---`
    : "";

  return `You are a shadow assistant for ${expertName}, an expert on the Help & Grow platform (AI Native Expert Network).
Your job is to draft a helpful response in ${expertName}'s style and voice.
The expert is currently offline — your draft will be reviewed by them before being sent.

Guidelines:
- Be professional, specific, and actionable
- Draw on the expert's known background and expertise
- If you're unsure about something, say "I'd recommend confirming with me directly" 
- Keep responses concise (2-4 paragraphs)
- Write in first person as if you are the expert${contextBlock}`;
}

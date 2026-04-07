import OpenAI from "openai";

import { prisma } from "@/lib/prisma";
import { domainStrings } from "@/lib/domains";
import { env } from "@/lib/env";
import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";
import { QwenTTSProvider } from "@/lib/integrations/qwen-tts";

const DASHSCOPE_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const DASHSCOPE_GENERATION_URL =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

const LLM_MODEL = "qwen-max";
const ASR_MODEL = "qwen3-asr-flash";

export const MAX_TURNS = 10;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ConversationState {
  expertId: string;
  systemPrompt: string;
  voiceModelId: string;
  history: ChatMessage[];
  turnCount: number;
  createdAt: number;
}

const conversations = new Map<string, ConversationState>();

function conversationKey(userId: string, expertId: string): string {
  return `${userId}:${expertId}`;
}

export function getConversation(
  userId: string,
  expertId: string,
): ConversationState | undefined {
  const key = conversationKey(userId, expertId);
  const conv = conversations.get(key);
  if (!conv) return undefined;
  const ageMs = Date.now() - conv.createdAt;
  if (ageMs > 30 * 60 * 1000) {
    conversations.delete(key);
    return undefined;
  }
  return conv;
}

export function resetConversation(userId: string, expertId: string): void {
  conversations.delete(conversationKey(userId, expertId));
}

export interface ExpertVoiceChatProfile {
  id: string;
  name: string;
  bio: string | null;
  domains: string[];
  voiceModelId: string;
  mem9Context: string[];
}

export async function loadExpertVoiceChatProfile(
  expertId: string,
): Promise<ExpertVoiceChatProfile | null> {
  const expert = await prisma.expert.findUnique({
    where: { id: expertId },
    select: {
      id: true,
      bio: true,
      domains: { select: { domain: true } },
      fishAudioModelId: true,
      user: { select: { name: true, nickName: true } },
    },
  });

  if (!expert?.fishAudioModelId) return null;

  const mem9Context = await searchExpertMemories(
    expertId,
    "What do you specialize in? What is your background and expertise?",
    5,
  ).catch(() => [] as string[]);

  return {
    id: expert.id,
    name: expert.user.nickName ?? expert.user.name ?? "Expert",
    bio: expert.bio,
    domains: domainStrings(expert.domains),
    voiceModelId: expert.fishAudioModelId,
    mem9Context,
  };
}

function buildSystemPrompt(profile: ExpertVoiceChatProfile): string {
  const memoryBlock =
    profile.mem9Context.length > 0
      ? `\n\nRelevant context from your memory:\n${profile.mem9Context.map((m) => `- ${m}`).join("\n")}`
      : "";

  return [
    `You are ${profile.name}, an expert in ${profile.domains.join(", ")}.`,
    profile.bio ? `Your background: ${profile.bio}` : "",
    "Answer questions as this expert would.",
    "Keep responses concise — 2-3 sentences max, since they will be spoken aloud.",
    "Be warm and helpful. If the question needs a deep dive, suggest booking a full session.",
    memoryBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

function ensureConversation(
  userId: string,
  profile: ExpertVoiceChatProfile,
): ConversationState {
  const key = conversationKey(userId, profile.id);
  let conv = conversations.get(key);
  if (conv && Date.now() - conv.createdAt < 30 * 60 * 1000) return conv;

  const systemPrompt = buildSystemPrompt(profile);
  conv = {
    expertId: profile.id,
    systemPrompt,
    voiceModelId: profile.voiceModelId,
    history: [{ role: "system", content: systemPrompt }],
    turnCount: 0,
    createdAt: Date.now(),
  };
  conversations.set(key, conv);
  return conv;
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
): Promise<string> {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not set");

  const dataUri = `data:${mimeType};base64,${audioBase64}`;

  const res = await fetch(DASHSCOPE_GENERATION_URL, {
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
    throw new Error(`ASR failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return (
    data?.output?.choices?.[0]?.message?.content?.[0]?.text ??
    data?.output?.text ??
    ""
  ).trim();
}

async function generateReply(conv: ConversationState, userText: string): Promise<string> {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not set");

  conv.history.push({ role: "user", content: userText });

  const qwen = new OpenAI({ apiKey, baseURL: DASHSCOPE_BASE_URL });
  const response = await qwen.chat.completions.create({
    model: LLM_MODEL,
    messages: conv.history,
  });

  const reply = response.choices[0]?.message?.content ?? "";
  conv.history.push({ role: "assistant", content: reply });
  conv.turnCount++;

  return reply;
}

async function synthesizeVoice(
  text: string,
  voiceModelId: string,
): Promise<{ audioBase64: string; format: string }> {
  const tts = new QwenTTSProvider();
  return tts.synthesize({ text, voiceId: voiceModelId });
}

export interface VoiceChatResult {
  userText: string;
  replyText: string;
  replyAudioBase64: string;
  replyAudioFormat: string;
  turnCount: number;
  maxTurns: number;
}

export async function processVoiceMessage(
  userId: string,
  expertId: string,
  audioBase64: string,
  mimeType: string,
): Promise<VoiceChatResult> {
  const profile = await loadExpertVoiceChatProfile(expertId);
  if (!profile) throw new Error("Expert does not have a cloned voice");

  const conv = ensureConversation(userId, profile);

  if (conv.turnCount >= MAX_TURNS) {
    throw new Error("Turn limit reached. Start a new conversation or book a full session.");
  }

  const userText = await transcribeAudio(audioBase64, mimeType);
  if (!userText) {
    throw new Error("Could not understand the audio. Please try again.");
  }

  const replyText = await generateReply(conv, userText);
  const { audioBase64: replyAudio, format } = await synthesizeVoice(
    replyText,
    conv.voiceModelId,
  );

  return {
    userText,
    replyText,
    replyAudioBase64: replyAudio,
    replyAudioFormat: format,
    turnCount: conv.turnCount,
    maxTurns: MAX_TURNS,
  };
}

export async function processTextMessage(
  userId: string,
  expertId: string,
  text: string,
): Promise<VoiceChatResult> {
  const profile = await loadExpertVoiceChatProfile(expertId);
  if (!profile) throw new Error("Expert does not have a cloned voice");

  const conv = ensureConversation(userId, profile);

  if (conv.turnCount >= MAX_TURNS) {
    throw new Error("Turn limit reached. Start a new conversation or book a full session.");
  }

  const replyText = await generateReply(conv, text);
  const { audioBase64: replyAudio, format } = await synthesizeVoice(
    replyText,
    conv.voiceModelId,
  );

  return {
    userText: text,
    replyText,
    replyAudioBase64: replyAudio,
    replyAudioFormat: format,
    turnCount: conv.turnCount,
    maxTurns: MAX_TURNS,
  };
}

// ---------------------------------------------------------------------------
// Real-time session tracking (used by /api/voice-chat/start and /stop)
// ---------------------------------------------------------------------------

export const RT_MAX_DURATION_SECONDS = 300; // 5-minute free cap

interface RealtimeSession {
  channelName: string;
  expertId: string;
  userId: string;
  startedAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

const rtSessions = new Map<string, RealtimeSession>();
const rtUserSessions = new Map<string, string>(); // userId -> channelName

export function hasRealtimeSession(userId: string): boolean {
  return rtUserSessions.has(userId);
}

export function getRealtimeSession(channelName: string): RealtimeSession | undefined {
  return rtSessions.get(channelName);
}

export function registerRealtimeSession(
  channelName: string,
  expertId: string,
  userId: string,
  onTimeout: (channelName: string) => void,
): RealtimeSession {
  const session: RealtimeSession = {
    channelName,
    expertId,
    userId,
    startedAt: Date.now(),
    timeoutId: setTimeout(() => onTimeout(channelName), RT_MAX_DURATION_SECONDS * 1000),
  };
  rtSessions.set(channelName, session);
  rtUserSessions.set(userId, channelName);
  return session;
}

export function removeRealtimeSession(channelName: string): RealtimeSession | undefined {
  const session = rtSessions.get(channelName);
  if (!session) return undefined;
  clearTimeout(session.timeoutId);
  rtSessions.delete(channelName);
  rtUserSessions.delete(session.userId);
  return session;
}

export async function startTenAgent(
  channelName: string,
  uid: number,
  profile: ExpertVoiceChatProfile,
): Promise<{ ok: boolean; error?: string }> {
  const tenUrl = process.env.TEN_AGENT_URL;
  if (!tenUrl) {
    return { ok: false, error: "TEN_AGENT_URL not configured" };
  }

  try {
    const res = await fetch(`${tenUrl}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: channelName,
        uid,
        expertId: profile.id,
        voiceModelId: profile.voiceModelId,
        systemPrompt: buildSystemPrompt(profile),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `TEN agent responded ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[voice-chat] Failed to start TEN agent:", msg);
    return { ok: false, error: msg };
  }
}

export async function stopTenAgent(channelName: string): Promise<void> {
  const tenUrl = process.env.TEN_AGENT_URL;
  if (!tenUrl) return;

  try {
    await fetch(`${tenUrl}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channelName }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error("[voice-chat] Failed to stop TEN agent:", err);
  }
}

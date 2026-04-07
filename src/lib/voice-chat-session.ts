import OpenAI from "openai";

import { prisma } from "@/lib/prisma";
import { domainStrings } from "@/lib/domains";
import { env } from "@/lib/env";
import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";
import {
  defaultQwenTtsVoiceId,
  QwenTTSProvider,
} from "@/lib/integrations/qwen-tts";

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
  /** Long-form intro script from onboarding — strong factual anchor for the persona. */
  avatarScript: string | null;
  /** Human-readable lines derived from servicesOffered JSON. */
  servicesOfferedSummary: string | null;
  /** Fish clone / VC model id, or a built-in Qwen voice name (e.g. Ethan). */
  voiceModelId: string;
  /** True when using expert's DashScope voice clone; false = system default voice. */
  usesClonedVoice: boolean;
}

function formatServicesOfferedJson(raw: unknown): string | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const lines = raw.map((item) => {
      if (item && typeof item === "object" && "title" in item) {
        const o = item as { title?: string; description?: string };
        const t = (o.title ?? "").trim();
        const d = (o.description ?? "").trim();
        if (t && d) return `- ${t}: ${d}`;
        if (t) return `- ${t}`;
      }
      return `- ${JSON.stringify(item)}`;
    });
    const joined = lines.filter(Boolean).join("\n");
    return joined.length > 0 ? joined : null;
  }
  if (typeof raw === "string") return raw.trim() || null;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

function resolveVoiceModelId(
  fishAudioModelId: string | null,
  gender: string | null,
): { voiceModelId: string; usesClonedVoice: boolean } {
  if (fishAudioModelId) {
    return { voiceModelId: fishAudioModelId, usesClonedVoice: true };
  }
  const override = env.VOICE_CHAT_DEFAULT_VOICE?.trim();
  if (override) {
    return { voiceModelId: override, usesClonedVoice: false };
  }
  return {
    voiceModelId: defaultQwenTtsVoiceId(gender),
    usesClonedVoice: false,
  };
}

export async function loadExpertVoiceChatProfile(
  expertId: string,
): Promise<ExpertVoiceChatProfile | null> {
  const expert = await prisma.expert.findUnique({
    where: { id: expertId },
    select: {
      id: true,
      bio: true,
      gender: true,
      avatarScript: true,
      servicesOffered: true,
      domains: { select: { domain: true } },
      fishAudioModelId: true,
      user: { select: { name: true, nickName: true } },
    },
  });

  if (!expert) return null;

  const { voiceModelId, usesClonedVoice } = resolveVoiceModelId(
    expert.fishAudioModelId,
    expert.gender,
  );

  const servicesOfferedSummary = formatServicesOfferedJson(expert.servicesOffered);

  return {
    id: expert.id,
    name: expert.user.nickName ?? expert.user.name ?? "Expert",
    bio: expert.bio,
    domains: domainStrings(expert.domains),
    avatarScript: expert.avatarScript,
    servicesOfferedSummary,
    voiceModelId,
    usesClonedVoice,
  };
}

function buildSystemPrompt(profile: ExpertVoiceChatProfile): string {
  return [
    `You are ${profile.name}, an expert in ${profile.domains.join(", ")}.`,
    profile.bio ? `Your background: ${profile.bio}` : "",
    profile.avatarScript
      ? `Your public introduction script (match this voice and factual claims):\n${profile.avatarScript}`
      : "",
    profile.servicesOfferedSummary
      ? `Services you list on your profile:\n${profile.servicesOfferedSummary}`
      : "",
    "Ground answers in the introduction, bio, and services above when relevant.",
    "This is a short voice preview: keep each reply concise enough for text-to-speech (aim under ~45 seconds spoken), but when the user asks for examples, client work, or specifics, give concrete details from your background or from the context attached to their message — avoid generic filler.",
    "Suggest booking a full paid session only when they need bespoke consulting, private data, or depth that clearly exceeds a fair preview — not for every question.",
  ]
    .filter(Boolean)
    .join("\n\n");
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

const VOICE_CHAT_MEMORY_SNIPPETS = 6;
const VOICE_CHAT_MEMORY_MAX_CHARS = 1_400;

async function generateReply(
  conv: ConversationState,
  expertId: string,
  userText: string,
): Promise<string> {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not set");

  const snippets = await searchExpertMemories(
    expertId,
    userText,
    VOICE_CHAT_MEMORY_SNIPPETS,
  ).catch(() => [] as string[]);

  let memoryBlock = snippets.join("\n---\n");
  if (memoryBlock.length > VOICE_CHAT_MEMORY_MAX_CHARS) {
    memoryBlock = `${memoryBlock.slice(0, VOICE_CHAT_MEMORY_MAX_CHARS)}\n…`;
  }

  const userContent =
    snippets.length > 0
      ? `[Retrieved from your mem9 / knowledge store — use concrete facts when relevant; do not invent details not supported below:]\n${memoryBlock}\n\n[User message]\n${userText}`
      : userText;

  conv.history.push({ role: "user", content: userContent });

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
  if (!profile) throw new Error("Expert not found");

  const conv = ensureConversation(userId, profile);

  if (conv.turnCount >= MAX_TURNS) {
    throw new Error("Turn limit reached. Start a new conversation or book a full session.");
  }

  const userText = await transcribeAudio(audioBase64, mimeType);
  if (!userText) {
    throw new Error("Could not understand the audio. Please try again.");
  }

  const replyText = await generateReply(conv, expertId, userText);
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
  if (!profile) throw new Error("Expert not found");

  const conv = ensureConversation(userId, profile);

  if (conv.turnCount >= MAX_TURNS) {
    throw new Error("Turn limit reached. Start a new conversation or book a full session.");
  }

  const replyText = await generateReply(conv, expertId, text);
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

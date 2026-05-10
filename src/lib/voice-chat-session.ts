import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { serviceTitles } from "@/lib/expert-topics";
import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";
import { getQwenTextModel } from "@/lib/ai/provider-catalog";
import { transcribeDashScopeAsr } from "@/lib/dashscope-asr";
import OpenAI from "openai";
import { QwenTTSProvider, defaultQwenTtsVoiceId } from "@/lib/integrations/qwen-tts";

export const MAX_TURNS = 5;
const DASHSCOPE_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const QWEN_VOICE_CHAT_MODEL = getQwenTextModel();
const VOICE_SYNTHESIS_TIMEOUT_MS = 12_000;
const VOICE_CHAT_LLM_TIMEOUT_MS = 25_000;

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
  ownerUserId: string;
  name: string;
  bio: string | null;
  /** Long-form intro script from onboarding — strong factual anchor for the persona. */
  avatarScript: string | null;
  /** Human-readable lines derived from servicesOffered JSON. */
  servicesOfferedSummary: string | null;
  /** Expert gender (used for Qwen built-in voice selection). */
  gender: string | null;
  /** Qwen TTS voice id used when the expert does not have a custom voice asset. */
  voiceModelId: string;
  /** Reserved for future expert-specific cloned voices; false = system-managed Qwen voice. */
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
  _fishAudioModelId: string | null,
  gender: string | null,
): { voiceModelId: string; usesClonedVoice: boolean } {
  const trimmedGender = gender?.trim() ?? "";
  const override = env.VOICE_CHAT_DEFAULT_VOICE?.trim();
  // Same rule as profile intro TTS: explicit male/female (any case) wins over fleet env default.
  if (!trimmedGender && override) {
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
      fishAudioModelId: true,
      user: { select: { id: true, name: true, nickName: true } },
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
    ownerUserId: expert.user.id,
    name: expert.user.nickName ?? expert.user.name ?? "Expert",
    bio: expert.bio,
    avatarScript: expert.avatarScript,
    servicesOfferedSummary,
    gender: expert.gender,
    voiceModelId,
    usesClonedVoice,
  };
}

function buildSystemPrompt(profile: ExpertVoiceChatProfile): string {
  return [
    `You are ${profile.name}, a real expert on Help & Grow.`,
    profile.bio ? `Your background: ${profile.bio}` : "",
    profile.avatarScript
      ? `Your public introduction script (match this voice and factual claims):\n${profile.avatarScript}`
      : "",
    profile.servicesOfferedSummary
      ? `Services you list on your profile:\n${profile.servicesOfferedSummary}`
      : "",
    "Speak as the expert directly. Do not mention AI, model, system prompt, avatar, simulation, or any tooling.",
    "Default to concise professional English.",
    "Only switch to another language when the user explicitly asks you to continue in that language.",
    "This is a short voice preview. Deliver one compact reply that can be spoken in under 60 seconds.",
    "Format constraint: one paragraph only; <= 100 words. If you use bullet points, use at most 3 bullets and keep them MECE (mutually exclusive, collectively exhaustive).",
    "Prioritize concrete judgment, structure, and personalization over generic encouragement.",
    "Use the introduction, services, retrieved memories, and user context as factual anchors whenever relevant.",
    "When the user asks for advice, tailor it to their stage, role, and likely scenario. If information is incomplete, make the best bounded assumption and state the most important factor you would confirm next.",
    "Whenever possible, demonstrate expertise with one precise angle, example, criterion, or tradeoff from your background.",
    "Only suggest scheduling a full paid meetup when deeper diagnosis, execution design, or private detail is genuinely needed.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function loadUserVoiceContext(
  userId: string,
  expertId: string,
): Promise<string | null> {
  const [user, expertProfile, priorBookings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        nickName: true,
      },
    }),
    prisma.expert.findUnique({
      where: { userId },
      select: {
        bio: true,
        servicesOffered: true,
      },
    }),
    prisma.booking.findMany({
      where: { founderId: userId, expertId },
      orderBy: { startTime: "desc" },
      take: 3,
      select: {
        startTime: true,
        status: true,
        sessionType: true,
      },
    }),
  ]);

  const lines: string[] = [];
  const displayName = user?.nickName ?? user?.name;
  if (displayName) lines.push(`User name: ${displayName}`);
  if (expertProfile) {
    const titles = serviceTitles(expertProfile.servicesOffered);
    if (titles.length > 0) {
      lines.push(`User also offers help with: ${titles.join(", ")}`);
    }
    if (expertProfile.bio) {
      lines.push(`User profile summary: ${expertProfile.bio.slice(0, 280)}`);
    }
  }
  if (priorBookings.length > 0) {
    lines.push(
      `User has ${priorBookings.length} prior meetup record(s) with this expert. Latest status: ${priorBookings[0]?.status}.`,
    );
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

function ensureVoiceChatAllowed(
  userId: string,
  profile: ExpertVoiceChatProfile,
): void {
  if (profile.ownerUserId === userId) {
    throw new Error("You cannot voice chat with your own expert profile.");
  }
}

function ensureConversation(
  userId: string,
  profile: ExpertVoiceChatProfile,
): ConversationState {
  const key = conversationKey(userId, profile.id);
  let conv = conversations.get(key);
  if (conv && Date.now() - conv.createdAt < 30 * 60 * 1000) {
    if (conv.voiceModelId !== profile.voiceModelId) {
      conv.voiceModelId = profile.voiceModelId;
    }
    return conv;
  }

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

function ensureDashScopeConfiguredForVoiceChat(): void {
  if (!env.DASHSCOPE_API_KEY?.trim()) {
    throw new Error("Voice chat requires DASHSCOPE_API_KEY (Qwen / DashScope).");
  }
}

let qwenChatClient: OpenAI | null = null;

function getQwenChatClient(): OpenAI {
  ensureDashScopeConfiguredForVoiceChat();
  if (!qwenChatClient) {
    qwenChatClient = new OpenAI({
      apiKey: env.DASHSCOPE_API_KEY?.trim() || "",
      baseURL: DASHSCOPE_BASE_URL,
      timeout: VOICE_CHAT_LLM_TIMEOUT_MS,
    });
  }
  return qwenChatClient;
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
): Promise<string> {
  ensureDashScopeConfiguredForVoiceChat();
  return transcribeDashScopeAsr(audioBase64, mimeType);
}

async function generateQwenReply(messages: ChatMessage[]): Promise<string> {
  const qwen = getQwenChatClient();
  try {
    const response = await qwen.chat.completions.create({
      model: QWEN_VOICE_CHAT_MODEL,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    return "I can help, but I’m hitting a temporary latency limit. - Clarify your goal and constraints - Share your current approach + blockers - I’ll give a MECE 3-point fix plan.";
  }
}

const VOICE_CHAT_MEMORY_SNIPPETS = 6;
const VOICE_CHAT_MEMORY_MAX_CHARS = 1_400;

async function generateReply(
  conv: ConversationState,
  expertId: string,
  userId: string,
  userText: string,
): Promise<string> {
  const snippets = await searchExpertMemories(
    expertId,
    userText,
    VOICE_CHAT_MEMORY_SNIPPETS,
  ).catch(() => [] as string[]);

  let memoryBlock = snippets.join("\n---\n");
  if (memoryBlock.length > VOICE_CHAT_MEMORY_MAX_CHARS) {
    memoryBlock = `${memoryBlock.slice(0, VOICE_CHAT_MEMORY_MAX_CHARS)}\n…`;
  }

  const userContext = await loadUserVoiceContext(userId, expertId).catch(
    () => null as string | null,
  );

  const userContent =
    [
      userContext ? `[User context]\n${userContext}` : "",
      snippets.length > 0
        ? `[Retrieved knowledge]\n${memoryBlock}`
        : "",
      `[User message]\n${userText}`,
    ]
      .filter(Boolean)
      .join("\n\n");

  conv.history.push({ role: "user", content: userContent });
  const reply = await generateQwenReply(conv.history);
  conv.history.push({ role: "assistant", content: reply });
  conv.turnCount++;

  return reply;
}

async function synthesizeVoice(
  text: string,
  voiceModelId: string,
  gender?: string | null,
): Promise<{ audioBase64: string; format: string }> {
  ensureDashScopeConfiguredForVoiceChat();
  const provider = new QwenTTSProvider();
  const voiceId = voiceModelId?.trim() || defaultQwenTtsVoiceId(gender ?? undefined);
  return provider.synthesize({ text, voiceId });
}

async function synthesizeVoiceIfAvailable(
  text: string,
  voiceModelId: string,
  gender?: string | null,
  timeoutMs: number = VOICE_SYNTHESIS_TIMEOUT_MS,
): Promise<{ audioBase64: string; format: string } | null> {
  try {
    return await Promise.race([
      synthesizeVoice(text, voiceModelId, gender),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[voice-chat] Voice synthesis unavailable:", message);
    return null;
  }
}

export function buildVoiceChatGreetingText(profile: ExpertVoiceChatProfile): string {
  const firstName = profile.name.split(/\s+/)[0] || profile.name;
  return `Hi, I'm ${firstName}. Tell me what's going on, and I'll give you a concise first take.`;
}

export function buildRealtimeChatGreetingText(profile: ExpertVoiceChatProfile): string {
  const firstName = profile.name.split(/\s+/)[0] || profile.name;
  return `Hi, I'm ${firstName}. Tell me what's going on, and I'll give you a clear direction first.`;
}

/** Opening greeting TTS only — does not consume a voice-chat turn or touch conversation state. */
export async function getVoiceChatGreeting(
  userId: string,
  expertId: string,
): Promise<{ text: string; replyAudioBase64?: string; replyAudioFormat?: string } | null> {
  const profile = await loadExpertVoiceChatProfile(expertId);
  if (!profile) return null;
  ensureVoiceChatAllowed(userId, profile);
  const text = buildVoiceChatGreetingText(profile);
  const audio = await synthesizeVoiceIfAvailable(
    text,
    profile.voiceModelId,
    profile.gender,
  );
  return {
    text,
    replyAudioBase64: audio?.audioBase64,
    replyAudioFormat: audio?.format,
  };
}

export async function getRealtimeChatGreeting(
  userId: string,
  expertId: string,
): Promise<{ text: string } | null> {
  const profile = await loadExpertVoiceChatProfile(expertId);
  if (!profile) return null;
  ensureVoiceChatAllowed(userId, profile);
  return { text: buildRealtimeChatGreetingText(profile) };
}

export interface VoiceChatResult {
  userText: string;
  replyText: string;
  replyAudioBase64?: string;
  replyAudioFormat?: string;
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
  ensureVoiceChatAllowed(userId, profile);

  const conv = ensureConversation(userId, profile);

  if (conv.turnCount >= MAX_TURNS) {
    throw new Error("Turn limit reached. Start a new conversation or schedule a full meetup.");
  }

  const userText = await transcribeAudio(audioBase64, mimeType);
  if (!userText) {
    throw new Error("Could not understand the audio. Please try again.");
  }

  const replyText = await generateReply(conv, expertId, userId, userText);
  const audio = await synthesizeVoiceIfAvailable(
    replyText,
    conv.voiceModelId,
    profile.gender,
  );

  return {
    userText,
    replyText,
    replyAudioBase64: audio?.audioBase64,
    replyAudioFormat: audio?.format,
    turnCount: conv.turnCount,
    maxTurns: MAX_TURNS,
  };
}

export async function processTextMessage(
  userId: string,
  expertId: string,
  text: string,
  options?: { synthesizeAudio?: boolean; voiceSynthesisTimeoutMs?: number },
): Promise<VoiceChatResult> {
  const profile = await loadExpertVoiceChatProfile(expertId);
  if (!profile) throw new Error("Expert not found");
  ensureVoiceChatAllowed(userId, profile);

  const conv = ensureConversation(userId, profile);

  if (conv.turnCount >= MAX_TURNS) {
    throw new Error("Turn limit reached. Start a new conversation or schedule a full meetup.");
  }

  const replyText = await generateReply(conv, expertId, userId, text);
  const audio =
    options?.synthesizeAudio === false
      ? null
      : await synthesizeVoiceIfAvailable(
          replyText,
          conv.voiceModelId,
          profile.gender,
          options?.voiceSynthesisTimeoutMs,
        );

  return {
    userText: text,
    replyText,
    replyAudioBase64: audio?.audioBase64,
    replyAudioFormat: audio?.format,
    turnCount: conv.turnCount,
    maxTurns: MAX_TURNS,
  };
}

export async function processVoiceDrafts(
  userId: string,
  expertId: string,
  clips: Array<{ audioBase64: string; mimeType: string }>,
): Promise<VoiceChatResult> {
  const profile = await loadExpertVoiceChatProfile(expertId);
  if (!profile) throw new Error("Expert not found");
  ensureVoiceChatAllowed(userId, profile);

  const conv = ensureConversation(userId, profile);
  if (conv.turnCount >= MAX_TURNS) {
    throw new Error("Turn limit reached. Start a new conversation or schedule a full meetup.");
  }
  if (clips.length === 0) {
    throw new Error("At least one audio clip is required.");
  }

  const parts = (
    await Promise.all(
      clips.map((clip) => transcribeAudio(clip.audioBase64, clip.mimeType)),
    )
  ).filter((text) => text.trim().length > 0);

  const userText = parts.join("\n");
  if (!userText.trim()) {
    throw new Error("Could not understand the audio. Please try again.");
  }

  const replyText = await generateReply(conv, expertId, userId, userText);
  const audio = await synthesizeVoiceIfAvailable(
    replyText,
    conv.voiceModelId,
    profile.gender,
  );

  return {
    userText,
    replyText,
    replyAudioBase64: audio?.audioBase64,
    replyAudioFormat: audio?.format,
    turnCount: conv.turnCount,
    maxTurns: MAX_TURNS,
  };
}

// ---------------------------------------------------------------------------
// Real-time session tracking (used by /api/voice-chat/start and /stop)
// ---------------------------------------------------------------------------

export const RT_MAX_DURATION_SECONDS = 180; // 3-minute cap

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

export function getRealtimeSessionForUser(userId: string): RealtimeSession | undefined {
  const channelName = rtUserSessions.get(userId);
  return channelName ? rtSessions.get(channelName) : undefined;
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

import { prisma } from "@/lib/prisma";
import { domainStrings } from "@/lib/domains";
import { searchExpertMemories } from "@/lib/integrations/mem9-lifecycle";

export const MAX_DURATION_SECONDS = 300; // 5-minute free cap

interface ActiveSession {
  channelName: string;
  expertId: string;
  userId: string;
  startedAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

const activeSessions = new Map<string, ActiveSession>();
const userSessions = new Map<string, string>(); // userId -> channelName

export function hasActiveSession(userId: string): boolean {
  return userSessions.has(userId);
}

export function getActiveSession(channelName: string): ActiveSession | undefined {
  return activeSessions.get(channelName);
}

export function getActiveSessionForUser(userId: string): ActiveSession | undefined {
  const ch = userSessions.get(userId);
  return ch ? activeSessions.get(ch) : undefined;
}

export function registerSession(
  channelName: string,
  expertId: string,
  userId: string,
  onTimeout: (channelName: string) => void,
): ActiveSession {
  const session: ActiveSession = {
    channelName,
    expertId,
    userId,
    startedAt: Date.now(),
    timeoutId: setTimeout(() => onTimeout(channelName), MAX_DURATION_SECONDS * 1000),
  };
  activeSessions.set(channelName, session);
  userSessions.set(userId, channelName);
  return session;
}

export function removeSession(channelName: string): ActiveSession | undefined {
  const session = activeSessions.get(channelName);
  if (!session) return undefined;
  clearTimeout(session.timeoutId);
  activeSessions.delete(channelName);
  userSessions.delete(session.userId);
  return session;
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

export function buildSystemPrompt(profile: ExpertVoiceChatProfile): string {
  const memoryBlock = profile.mem9Context.length > 0
    ? `\n\nRelevant context from your memory:\n${profile.mem9Context.map((m) => `- ${m}`).join("\n")}`
    : "";

  return [
    `You are ${profile.name}, an expert in ${profile.domains.join(", ")}.`,
    profile.bio ? `Your background: ${profile.bio}` : "",
    "Answer questions as this expert would. Keep responses concise and natural for voice conversation.",
    "Be warm, helpful, and encourage the learner to book a full session if they want deeper guidance.",
    memoryBlock,
  ].filter(Boolean).join("\n");
}

export async function startTenAgent(
  channelName: string,
  uid: number,
  profile: ExpertVoiceChatProfile,
): Promise<{ ok: boolean; error?: string }> {
  const tenUrl = process.env.TEN_AGENT_URL;
  if (!tenUrl) {
    console.warn("[voice-chat] TEN_AGENT_URL not set — agent will not join the channel");
    return { ok: true };
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

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

export interface ProfileInput {
  linkedIn?: string;
  website?: string;
  twitter?: string;
  substack?: string;
  instagram?: string;
  xiaohongshu?: string;
  nickName: string;
  resumeText?: string;
}

export interface ServiceItem {
  title: string;
  description: string;
}

export interface ProfileOutput {
  bio: string;
  services: ServiceItem[];
  videoScript: string;
  sourceSummary: string;
}

export interface ImageInput {
  nickName: string;
  bio: string;
  gender?: string;
}

export interface MatchResult {
  recommendations: {
    expertId: string;
    name: string;
    reason: string;
    sessionTypes: string[];
  }[];
  noMatchMessage?: string;
}

export interface NormalizedQuery {
  english: string;
  keywords: string[];
  intent: "specific_topic" | "broad_exploration" | "greeting";
  original: string;
}

export interface AIProvider {
  generateExpertProfile(data: ProfileInput): Promise<ProfileOutput>;
  generateProfileImage(data: ImageInput): Promise<string | null>;
  improveWriting(type: "intro" | "services", content: string): Promise<string>;
  normalizeQuery(query: string): Promise<NormalizedQuery>;
  matchExperts(
    query: string,
    expertSummaries: string,
    conversationHistory: { role: string; content: string }[],
    normalizedQuery?: NormalizedQuery
  ): Promise<MatchResult>;
  extractTextFromPdf(buffer: Buffer): Promise<string>;
}

// ---------------------------------------------------------------------------
// Response parsing helpers
// ---------------------------------------------------------------------------

export function cleanJsonResponse(text: string): string {
  let cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];
  return cleaned;
}

export function ensureString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(ensureString).join("\n");
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .map(([k, v]) => `**${k}**: ${ensureString(v)}`)
      .join("\n");
  }
  return String(value ?? "");
}

export function parseProfileResponse(text: string): ProfileOutput {
  const cleaned = cleanJsonResponse(text);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("[AI] Failed to parse profile JSON, raw:", text.slice(0, 500));
    throw new Error("AI returned invalid response format. Please try again.");
  }

  if (parsed.sourceSummary) {
    console.log("[AI] Source summary:", parsed.sourceSummary);
  }

  return {
    bio: ensureString(parsed.bio),
    services: Array.isArray(parsed.services) ? parsed.services : [],
    videoScript: ensureString(parsed.videoScript),
    sourceSummary: ensureString(parsed.sourceSummary ?? ""),
  };
}

export function parseMatchResponse(text: string): MatchResult {
  if (!text.trim()) {
    throw new Error("Empty response from AI model");
  }
  const cleaned = cleanJsonResponse(text);
  try {
    return JSON.parse(cleaned) as MatchResult;
  } catch {
    console.error("[AI] Failed to parse match response:", text.slice(0, 500));
    throw new Error("Failed to parse AI response");
  }
}

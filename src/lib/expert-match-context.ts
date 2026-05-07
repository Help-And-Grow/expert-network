/**
 * Build the per-expert context block that gets fed to the LLM matcher.
 *
 * Used by both `/api/experts/match` (the discover route) and `chat-engine.ts`
 * (the platform-agnostic chat used by Telegram + WeChat). Keeping a single
 * builder means the two surfaces always see the same shape — if we add
 * a field here (e.g. PDF-extracted text once that pipeline lands), every
 * caller benefits.
 *
 * Design notes:
 * - We DON'T include `documentData` (the base64-encoded PDF). It's huge and
 *   would blow the LLM context window for any pool >5 experts. Showing
 *   `documentName` + a "Document on file" flag tells the model that the
 *   expert has a resume/CV uploaded — relevance signal without the bulk.
 *   When PDF text-extraction-at-index-time lands, we'll add a
 *   `documentSummary` field to this builder.
 * - `avatarScript` is the introduction memo recorded during onboarding;
 *   often richer than the bio because it's spoken-form narrative.
 * - Social platform URLs are condensed to "linkedin, twitter, xiaohongshu"
 *   — just the platforms the expert publishes on, so the LLM can match
 *   regional / topical signal (xiaohongshu = consumer / lifestyle in CN,
 *   substack = long-form thought leadership, etc.).
 */

import {
  buildExpertFocusLabel,
  stringifyServicesOffered,
} from "@/lib/expert-topics";

export interface ExpertMatchContext {
  id: string;
  bio: string | null;
  avatarScript: string | null;
  gender?: string | null;
  sessionType: string;
  servicesOffered: unknown;
  linkedIn: string | null;
  twitter: string | null;
  substack: string | null;
  instagram: string | null;
  xiaohongshu: string | null;
  documentName: string | null;
  user: { nickName: string | null; name: string | null };
}

/** Trim a long block for the LLM context window — preserves whole-word boundaries. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function activeSocialPlatforms(e: ExpertMatchContext): string[] {
  const platforms: string[] = [];
  if (e.linkedIn?.trim()) platforms.push("LinkedIn");
  if (e.twitter?.trim()) platforms.push("X/Twitter");
  if (e.substack?.trim()) platforms.push("Substack");
  if (e.instagram?.trim()) platforms.push("Instagram");
  if (e.xiaohongshu?.trim()) platforms.push("Xiaohongshu");
  return platforms;
}

/**
 * Build the per-expert context string the LLM sees.
 *
 * @param expert  The expert row (joined with user.nickName/name).
 * @param memories Snippets from the long-term memory store (mem9), already
 *                 retrieved by the caller via searchExpertMemories(query).
 *                 Pass an empty array if memory search was skipped/failed.
 */
export function buildLLMExpertContext(
  expert: ExpertMatchContext,
  memories: string[] = [],
): string {
  const lines: string[] = [];
  lines.push(`ID: ${expert.id}`);
  lines.push(`Name: ${expert.user.nickName ?? expert.user.name ?? "Unknown"}`);
  if (expert.gender?.trim()) {
    lines.push(`Gender: ${expert.gender.trim()}`);
  }
  lines.push(
    `Focus: ${buildExpertFocusLabel(expert) ?? "General professional support"}`,
  );
  lines.push(`Session types: ${expert.sessionType}`);

  const bio = expert.bio?.trim();
  // Bio is plain text from the expert, often the most direct expertise signal.
  // Clamp generously (600 chars) — most bios are 2-3 sentences anyway.
  lines.push(`Bio: ${bio ? clamp(bio, 600) : "(none)"}`);

  const services = stringifyServicesOffered(expert.servicesOffered);
  lines.push(`Services: ${services || "(none)"}`);

  // Avatar script — the expert's recorded "about me" intro memo. Often
  // covers things the bio doesn't (specific projects, lived experience).
  const script = expert.avatarScript?.trim();
  if (script) {
    lines.push(`Intro memo: ${clamp(script, 800)}`);
  }

  const platforms = activeSocialPlatforms(expert);
  if (platforms.length > 0) {
    lines.push(`Active on: ${platforms.join(", ")}`);
  }

  if (expert.documentName?.trim()) {
    lines.push(`Document on file: ${expert.documentName.trim()}`);
  }

  if (memories.length > 0) {
    // Keep memories concise — full memories can balloon the prompt.
    const merged = memories.join("; ");
    lines.push(`Long-term memory snippets: ${clamp(merged, 600)}`);
  }

  return lines.join("\n");
}

/**
 * Build the compact semantic source text embedded for cross-expert search.
 *
 * This intentionally mirrors the same high-signal fields as
 * buildLLMExpertContext without the field labels that are useful for a prompt
 * but noisy for embeddings.
 */
export function buildExpertEmbeddingText(
  expert: ExpertMatchContext,
  memories: string[] = [],
): string {
  const name = expert.user.nickName ?? expert.user.name ?? "Unknown expert";
  const focus = buildExpertFocusLabel(expert) ?? "general professional support";
  const lines: string[] = [`${name} - ${focus}.`];

  const bio = expert.bio?.trim();
  if (bio) lines.push(clamp(bio, 600));

  const services = stringifyServicesOffered(expert.servicesOffered);
  if (services) lines.push(`Services: ${services}.`);

  const script = expert.avatarScript?.trim();
  if (script) lines.push(`Intro memo: ${clamp(script, 800)}`);

  const platforms = activeSocialPlatforms(expert);
  if (platforms.length > 0) {
    lines.push(`Active on: ${platforms.join(", ")}.`);
  }

  const snippets = memories
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (snippets.length > 0) {
    lines.push(`Recent memory snippets: ${clamp(snippets.join("; "), 600)}`);
  }

  return clamp(lines.join("\n\n"), 8000);
}

export function getExpertDisplayName(expert: ExpertMatchContext): string {
  return expert.user.nickName ?? expert.user.name ?? "This expert";
}

export function neutralizeExpertReasonPronouns(
  reason: string,
  expert: ExpertMatchContext,
): string {
  const name = getExpertDisplayName(expert);
  return reason
    .replace(
      /(^|[.!?]\s+)(he|she|they)\b/gi,
      (_match, prefix: string) => `${prefix}${name}`,
    )
    .replace(
      /(^|[.!?]\s+)(his|her|their)\b/gi,
      (_match, prefix: string) => `${prefix}${name}'s`,
    );
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^.{40,220}?[.!?](?:\s|$)/);
  return (match?.[0] ?? trimmed.slice(0, 180)).trim();
}

/** Split a text blob into sentences. Naive but works on EN + ZH boundaries. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？])\s+|(?<=[.!?。！？])(?=\S)|\n+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 400);
}

/**
 * Lower-cased query keywords useful for substring matching against an
 * expert's profile text. Trims trivial stop words and tokens shorter than 2
 * chars; keeps Chinese tokens whole because tokenisation is non-trivial and
 * the substring `text.includes(token)` works fine for CJK.
 */
function extractQueryKeywords(query: string): string[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return [];
  const stopwords = new Set([
    "the", "a", "an", "and", "or", "for", "of", "in", "on", "to", "with",
    "i", "we", "my", "our", "you", "your", "is", "are", "be", "do", "does",
    "need", "want", "looking", "find", "expert", "experts", "help",
    "请", "找", "需要", "希望", "想", "我", "你", "的", "在", "和",
  ]);
  const tokens = lower
    .split(/[\s,;:.!?。！？、，；：]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stopwords.has(t));
  // Also include the whole query as a phrase, so multi-word phrases like
  // "BD Singapore" can match as a unit.
  return Array.from(new Set([lower, ...tokens]));
}

/**
 * Find the sentence in `text` that mentions the most query keywords.
 * Returns null when no sentence contains any keyword.
 */
function findRelevantSentence(text: string, keywords: string[]): string | null {
  const sentences = splitSentences(text);
  if (sentences.length === 0 || keywords.length === 0) return null;

  let best: { sentence: string; score: number } | null = null;
  for (const s of sentences) {
    const lower = s.toLowerCase();
    const score = keywords.reduce(
      (acc, kw) => acc + (lower.includes(kw) ? 1 : 0),
      0,
    );
    if (score > 0 && (!best || score > best.score)) {
      best = { sentence: s, score };
    }
  }
  return best?.sentence ?? null;
}

/**
 * Build a one-sentence reason explaining why this expert matched the query,
 * grounded in the expert's own profile text. Does NOT make an LLM call so it
 * stays compatible with the vector fast path.
 *
 * Strategy (in priority order):
 *   1. Find a sentence in bio + avatarScript + services that contains the
 *      query keywords — that's the most direct "why this matched" signal.
 *   2. Fall back to the first usable sentence of avatarScript / bio.
 *   3. Fall back to the focus label or services list.
 *   4. Last resort: a generic "matches your request" string.
 *
 * Pass `query` whenever available — without it we lose the extractive step
 * (#1) and reasons read as generic "first sentence of profile".
 */
export function buildDeterministicExpertMatchReason(
  expert: ExpertMatchContext,
  query?: string,
): string {
  const name = getExpertDisplayName(expert);
  const focus = buildExpertFocusLabel(expert);
  const bio = expert.bio?.trim();
  const script = expert.avatarScript?.trim();
  const services = stringifyServicesOffered(expert.servicesOffered);

  const profileText = [bio, script, services].filter(Boolean).join("\n\n");

  // 1. Extractive: pull the sentence that mentions query keywords.
  if (query && profileText) {
    const keywords = extractQueryKeywords(query);
    const matched = findRelevantSentence(profileText, keywords);
    if (matched) return neutralizeExpertReasonPronouns(matched, expert);
  }

  // 2. First useful sentence from the richest available source. avatarScript
  //    is usually the spoken-form intro the expert recorded — most fluent
  //    and concrete; prefer it over bio when both exist.
  const richest = script || bio;
  if (richest) {
    return neutralizeExpertReasonPronouns(firstSentence(richest), expert);
  }

  // 3. Services list (e.g. "Localisation in Japan") makes a fine reason on
  //    its own when nothing else is set.
  if (services) {
    return `${name}'s services include ${services}.`;
  }

  // 4. Focus label as final structured fallback.
  if (focus) return `${name} — ${focus}.`;

  return `${name} matches your request.`;
}

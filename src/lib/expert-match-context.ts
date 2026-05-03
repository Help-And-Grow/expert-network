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

export function buildDeterministicExpertMatchReason(
  expert: ExpertMatchContext,
): string {
  const name = getExpertDisplayName(expert);
  const focus = buildExpertFocusLabel(expert);
  const bio = expert.bio?.trim();
  const services = stringifyServicesOffered(expert.servicesOffered);
  const detail = bio
    ? neutralizeExpertReasonPronouns(firstSentence(bio), expert)
    : services
      ? `${name}'s listed services include ${services}.`
      : "";

  if (focus && detail) {
    return `${name}'s profile is a strong semantic match for ${focus}. ${detail}`;
  }
  if (focus) {
    return `${name}'s profile is a strong semantic match for ${focus}.`;
  }
  if (detail) return detail;
  return `${name}'s published profile is one of the closest semantic matches for this request.`;
}

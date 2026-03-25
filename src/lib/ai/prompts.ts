import type { ProfileInput, ImageInput } from "./types";

// ---------------------------------------------------------------------------
// Social link formatting
// ---------------------------------------------------------------------------

export function formatSocialLinks(data: ProfileInput): string {
  return [
    data.linkedIn && `LinkedIn: ${data.linkedIn}`,
    data.website && `Official Website: ${data.website}`,
    data.twitter && `X/Twitter: ${data.twitter}`,
    data.substack && `Substack: ${data.substack}`,
    data.instagram && `Instagram: ${data.instagram}`,
    data.xiaohongshu && `XiaoHongShu: ${data.xiaohongshu}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Image prompt
// ---------------------------------------------------------------------------

const DOMAIN_VISUALS: Record<string, string> = {
  "Marketing & BD":
    "megaphone waves, handshake silhouette, growth analytics charts, globe with connection arcs",
  Headhunter:
    "magnifying glass over profile cards, talent pipeline, connecting dots",
  Law: "balanced scales, gavel silhouette, document layers with legal seals",
  Funding:
    "rising bar charts, currency symbols, rocket launch trail, investor handshake",
};

export function buildImagePrompt(data: ImageInput): string {
  const bioSnippet = data.bio.slice(0, 200);
  const visualElements = data.domains
    .map((d) => DOMAIN_VISUALS[d] || d.toLowerCase())
    .join("; ");

  const genderDesc =
    data.gender === "female"
      ? "female"
      : data.gender === "male"
        ? "male"
        : "";
  const personDesc = [genderDesc, "professional expert"]
    .filter(Boolean)
    .join(" ");
  const nameHint = data.nickName
    ? ` The character's name is "${data.nickName}" — reflect a culturally appropriate appearance for this name.`
    : "";

  return `A stylized digital avatar illustration of a ${personDesc}. Modern cartoon style, NOT a real photo. The character has a confident, approachable expression shown from shoulders up. Rich indigo and purple color palette.${nameHint} Background has floating abstract elements: ${visualElements}. Premium, creative, slightly playful professional feel. The character wears modern business-casual attire with subtle details reflecting expertise in ${data.domains.join(" and ")}. Context: ${bioSnippet}. No text or watermarks in the image.`;
}

// ---------------------------------------------------------------------------
// Search grounding prompt (separate step for non-Gemini providers)
// ---------------------------------------------------------------------------

export function buildSearchPrompt(name: string, socialLinks: string): string {
  return `Search for publicly available information about "${name}" using the social profile links below. For each link, gather ONLY verifiable facts you find through Google Search:

${socialLinks}

For each platform, report:
- Job title, company, professional headline
- Real work history and achievements
- Follower/subscriber/connection counts (exact numbers only)
- Content themes and recent posts
- Any other publicly visible professional details

IMPORTANT: If Google Search returns NO usable results for a platform, state clearly: "No data found for [platform]". Do NOT fabricate or guess.

Return your findings as a structured text report, organized by platform.`;
}

// ---------------------------------------------------------------------------
// Profile generation — shared JSON schema & rules
// ---------------------------------------------------------------------------

const PROFILE_JSON_SCHEMA = `1. "bio" (STRING — must be a single markdown-formatted string, NOT an object or array):
Write a concise third-person summary in markdown bullet points:
- **Current Role**: Job title and company (only if verified)
- **Expertise**: 2-3 bullet points on distinct domain areas
- **Track Record**: 1-2 bullet points with verifiable achievements
- **Social Presence**: Only mention platforms where real data was found.
Keep under 100 words. No fluff.

2. "services" (ARRAY of objects): 3-4 services following MECE (Mutually Exclusive, Collectively Exhaustive) principle. Each service covers a distinct, non-overlapping area. Format: {"title": "concise service name (3-5 words)", "description": "one-sentence value proposition for founders"}

3. "videoScript" (STRING): A natural first-person introduction (45-60 seconds spoken). Use ONLY verified facts. Structure: who I am → what I do → how I help founders → book a session CTA.

4. "sourceSummary" (STRING): Which platforms had useful data and which did not. Example: "Found data from: LinkedIn, Official Website. No data: X/Twitter."`;

const PROFILE_RULES = `ABSOLUTE RULES — Truth over polish:
- NEVER fabricate or estimate numbers. If you cannot find a follower count, do NOT mention one.
- NEVER invent companies, job titles, achievements, or descriptions not found in search results or the uploaded document.
- NEVER describe content themes for a platform you could not access.
- A short, honest profile is ALWAYS better than a detailed but fabricated one.
- If you only have the uploaded document and no search results, say so — build the profile from the document alone.
- "bio" must be a plain string with markdown formatting, never a JSON object or array.

Return ONLY the JSON object, no markdown code fences.`;

/**
 * Gemini single-step: the model itself does Google Search via the
 * `googleSearch` tool, so the prompt tells it to research the links.
 */
export function buildProfilePromptWithNativeSearch(
  data: ProfileInput,
  socialLinks: string,
  resumeSection: string
): string {
  return `You are creating a professional profile on Help & Grow — the AI Native Expert Network (Singapore & Southeast Asia). Everyone can be both expert and learner; profiles may serve people booking sessions for advice OR offering their own expertise.

Expert's name: ${data.nickName}
Professional domains: ${data.domains.join(", ")}
Social profiles:
${socialLinks}${resumeSection}

STEP 1 — Research: Use Google Search to look up EACH social profile link AND the expert's name. For LinkedIn, also search for "[name] LinkedIn [company]" to find cached profile data. Gather ONLY verifiable facts:
- Job title, company, professional headline
- Real work history and achievements
- Follower/subscriber/connection counts (exact numbers only if found)
- Content themes and recent posts
- For Instagram/XiaoHongShu: follower count, content focus
- For Official Website: services offered, company info, testimonials

IMPORTANT: Some platforms (X/Twitter, XiaoHongShu/RedBook) block Google indexing. If Google Search returns NO usable results for a platform, honestly state that you could not find information for that platform. Do NOT guess, infer, or fabricate details for platforms you could not search.

STEP 2 — Merge sources and assess what you actually found:
- For each social link, note whether Google Search returned real data or not.
- Combine verified facts from Google Search WITH the uploaded document (if provided).
- The uploaded document (resume/CV) is a TRUSTED source — use it for experience, skills, and achievements.
- Google Search results are useful for latest role, public presence, and follower counts.
- If a social link returned no data from search, do NOT pretend you found something. Simply omit it.

STEP 3 — Generate a JSON object with these 4 keys:

${PROFILE_JSON_SCHEMA}

IMPORTANT: "bio" must be a plain string with markdown formatting, never a JSON object or array.

${PROFILE_RULES}`;
}

/**
 * Two-step: search results are already fetched by the search helper and
 * injected into the prompt. Used by Qwen, OpenAI, and any future provider
 * that lacks native search grounding.
 */
export function buildProfilePromptFromResearch(
  data: ProfileInput,
  searchResults: string,
  resumeSection: string
): string {
  return `You are creating a professional profile on Help & Grow — the AI Native Expert Network (Singapore & Southeast Asia). Everyone can be both expert and learner; profiles may serve people booking sessions for advice OR offering their own expertise.

Expert's name: ${data.nickName}
Professional domains: ${data.domains.join(", ")}

=== RESEARCH RESULTS (from Google Search) ===
${searchResults}
=== END RESEARCH RESULTS ===${resumeSection}

Based on the research results above and the uploaded document (if provided), generate a JSON object with these 4 keys:

${PROFILE_JSON_SCHEMA}

${PROFILE_RULES}`;
}

// ---------------------------------------------------------------------------
// Improve writing
// ---------------------------------------------------------------------------

export function buildImproveWritingPrompt(
  type: "intro" | "services",
  content: string
): string {
  if (type === "intro") {
    return `You are a professional copywriter for Help & Grow — the AI Native Expert Network.

Improve this professional's introduction script. Rules:
- Keep ALL facts, names, and claims unchanged
- Maintain first-person tone
- Make it more professional, concise, and engaging
- Target 45-60 seconds spoken length
- Do NOT add fabricated details
- Return ONLY the improved text, no explanations or quotes

Current introduction:
${content}`;
  }

  return `You are a professional copywriter for Help & Grow — the AI Native Expert Network.

Improve these service offerings. Rules:
- Keep the same meaning and number of services
- Make titles clearer and punchier (3-6 words)
- Make descriptions more compelling and concise (one sentence each)
- Do NOT add new services or remove existing ones
- Return ONLY a JSON array of objects with "title" and "description" keys, no markdown code fences

Current services:
${content}`;
}

// ---------------------------------------------------------------------------
// Match experts
// ---------------------------------------------------------------------------

export function buildMatchExpertsPrompt(
  query: string,
  expertSummaries: string,
  conversationHistory: { role: string; content: string }[]
): string {
  const historyContext = conversationHistory
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  return `You are the AI matchmaking assistant for Help & Grow — the AI Native Expert Network (Singapore & Southeast Asia). Members are both experts and learners: users may be seeking help, offering expertise, or both. The pool below lists people who publish sessions as experts.

Here is the pool of available experts:
${expertSummaries}

${historyContext ? `Previous conversation:\n${historyContext}\n` : ""}

The user's latest query: "${query}"

Based on your deep analysis of the user's needs and the expert pool, recommend the top 2-3 most relevant experts. For each recommendation, provide:

1. "expertId": The expert's ID
2. "name": The expert's name
3. "reason": A highly specific 2-3 sentence explanation of why this expert's background perfectly matches the user's need.
4. "sessionTypes": Available session types

If no expert matches well, return empty "recommendations" array with a "noMatchMessage" string.

Return ONLY a JSON object, no markdown code fences.`;
}

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------

export const PDF_EXTRACTION_PROMPT =
  "Extract all text content from this PDF document. Return ONLY the extracted text, preserving the structure (headings, lists, paragraphs). Do not add any commentary or explanation.";

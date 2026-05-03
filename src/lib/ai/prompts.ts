import type { ImageInput, ProfileInput } from "./types";

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

export function buildImagePrompt(data: ImageInput): string {
  const bioSnippet = data.bio.slice(0, 200);
  const visualElements =
    bioSnippet.length > 0
      ? `clean professional motifs inspired by: ${bioSnippet}`
      : "clean professional motifs, subtle studio lighting, thoughtful business context";

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

  return `A stylized digital avatar illustration of a ${personDesc}. Modern cartoon style, NOT a real photo. The character has a confident, approachable expression shown from shoulders up. Rich indigo and purple color palette.${nameHint} Background has floating abstract elements: ${visualElements}. Premium, creative, slightly playful professional feel. The character wears modern business-casual attire. Context: ${bioSnippet}. No text or watermarks in the image.`;
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

3. "videoScript" (STRING): A natural first-person introduction (45-60 seconds spoken). Use ONLY verified facts. Structure: who I am → what I do → how I help founders → invite them to schedule a meetup (sharing, not lecturing).

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
  return `You are creating a professional profile on Help & Grow — the AI Native Expert Network (Singapore & Southeast Asia). Everyone can be both coach and player (learn by doing, grow by helping); profiles may serve people scheduling meetups for insight OR offering their own expertise to share.

Expert's name: ${data.nickName}
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
  return `You are creating a professional profile on Help & Grow — the AI Native Expert Network (Singapore & Southeast Asia). Everyone can be both expert and player (learn by doing, grow by helping); profiles may serve people scheduling meetups for insight OR offering their own expertise to share.

Expert's name: ${data.nickName}

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
// Query normalization (multilingual → English keywords + intent)
// ---------------------------------------------------------------------------

export function buildNormalizeQueryPrompt(query: string): string {
  return `You are a query understanding module. The user typed a search query which may be in ANY language (Chinese, English, Malay, etc.).

Input query: "${query}"

Return ONLY a JSON object (no markdown fences) with:
1. "english": the query translated to English (keep original if already English)
2. "keywords": an array of 5-10 English keywords/synonyms relevant to the query topic (think broadly — include the profession, related skills, industry terms)
3. "intent": one of "specific_topic", "broad_exploration", or "greeting" — classify the user's intent
4. "original": the original query unchanged

Examples:
- "法律" → {"english":"law","keywords":["law","legal","lawyer","attorney","compliance","contract","litigation","corporate law","regulatory","counsel"],"intent":"specific_topic","original":"法律"}
- "hi" → {"english":"hi","keywords":["hello","greeting"],"intent":"greeting","original":"hi"}
- "AI" → {"english":"artificial intelligence","keywords":["artificial intelligence","machine learning","deep learning","AI","data science","LLM","neural network","NLP","automation","technology"],"intent":"specific_topic","original":"AI"}`;
}

// ---------------------------------------------------------------------------
// Match experts
// ---------------------------------------------------------------------------

export function buildMatchExpertsPrompt(
  query: string,
  expertSummaries: string,
  conversationHistory: { role: string; content: string }[],
  normalizedQuery?: { english: string; keywords: string[] }
): string {
  const historyContext = conversationHistory
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const queryContext = normalizedQuery
    ? `The user's latest query: "${query}"
Interpreted as: "${normalizedQuery.english}"
Related keywords: ${normalizedQuery.keywords.join(", ")}`
    : `The user's latest query: "${query}"`;

  return `You are the AI matchmaking assistant for Help & Grow — the AI Native Expert Network (Singapore & Southeast Asia). Members are both experts and players: users may be seeking help, offering expertise to share, or both. The pool below lists people who publish meetups as experts.

Here is the pool of available experts (each separated by ---). Each expert may have: a gender, a bio, an intro memo (their own words), services offered, the social platforms they publish on, an uploaded resume/CV, and long-term memory snippets surfaced from past conversations:
${expertSummaries}

${historyContext ? `Previous conversation:\n${historyContext}\n` : ""}

${queryContext}

Recommend the top 2-3 experts whose actual expertise — as inferred from their bio, intro memo, services, and memory snippets taken together — addresses the user's underlying need. Return at most 3, fewer if only one or two are genuinely relevant.

For each recommendation provide:

1. "expertId": The expert's ID (must be one from the pool above, verbatim)
2. "name": The expert's name
3. "reason": A 2-3 sentence explanation in plain language about WHY this expert can help — grounded in concrete experience or expertise visible in their profile. Refer to specific topics, projects, or skills they've worked on. Speak about the expert in third person.
4. "sessionTypes": Available session types from their "Session types" field

CRITICAL — what to do and NOT do:

- Do NOT pattern-match on individual words. "I am familiar with X" in a bio does NOT mean the expert can help with anything containing the word "familiar". Reason about the WHOLE profile, including the intro memo, services, and any memory snippets, as a coherent picture of the person.
- Do NOT infer gender from a name. If gender is available, use it correctly; otherwise use the expert's name instead of he/she pronouns.
- Prefer starting each reason with the expert's name rather than a pronoun.
- Do NOT write reasons of the form "their profile mentions 'X'" or "their bio contains the keyword 'Y'". A good reason references concrete expertise: "Yu Xu has built e-commerce launches in Southeast Asia and led a Stripe integration at her previous startup", not "Her profile mentions 'e-commerce, Stripe'".
- Do NOT recommend experts just because they are popular, highly rated, or generally helpful. Relevance to the user's specific need is the ONLY criterion.
- If the user's query is about a SPECIFIC PERSON who is NOT one of the experts in the pool above (e.g. asking "is X familiar with Y" where X is not listed), return empty "recommendations" with a "noMatchMessage" explaining that you can only recommend experts in the network and inviting them to describe what kind of expertise they're looking for instead.
- If NO expert in the pool genuinely covers the topic, return empty "recommendations" with a "noMatchMessage" describing the kind of expertise that would fit and asking the user to rephrase or browse another way. Returning a weak or off-topic match is WORSE than returning none.

Return ONLY a JSON object with shape \`{"recommendations": [...], "noMatchMessage"?: string}\`. No markdown code fences, no commentary.`;
}

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------

export const PDF_EXTRACTION_PROMPT =
  "Extract all text content from this PDF document. Return ONLY the extracted text, preserving the structure (headings, lists, paragraphs). Do not add any commentary or explanation.";

export const SYSTEM_PROMPTS = {
  PROFILE_BUILDER: "You are an expert profile writer for Help & Grow. You format text exactly as requested and never fabricate facts. Return valid JSON only.",
  QUERY_NORMALIZER: "You are a query analysis assistant. Your job is to extract intent and keywords from user input.",
  MATCHMAKER: "You are an AI matchmaking assistant connecting users with experts based on relevance.",
  COPYWRITER: "You are a professional copywriter. Your task is to improve the tone, clarity, and impact of the provided text while keeping its original meaning.",
};

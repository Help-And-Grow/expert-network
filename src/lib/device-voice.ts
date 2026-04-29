/**
 * Browser `speechSynthesis` voice selection that respects the expert's gender.
 *
 * The default device voice (e.g. macOS "Samantha", Chrome's "Google US English"
 * on Windows) is typically female. When server TTS falls through to the device
 * voice fallback, we want to keep the gender consistent with the expert's
 * profile. This module is the single place that does that selection.
 */

import { isFemaleExpertGender } from "@/lib/expert-voice-gender";

/**
 * Lower-case substrings that consistently identify a *male* voice across
 * macOS, iOS, Android, Chrome (Google), and Edge (Microsoft). Order matters —
 * earlier entries are preferred when several candidates match.
 */
const MALE_VOICE_HINTS = [
  // Generic
  "male",
  // macOS / iOS classics
  "alex",
  "daniel",
  "aaron",
  "fred",
  "albert",
  "junior",
  "ralph",
  "tom",
  // Microsoft
  "microsoft david",
  "microsoft mark",
  "microsoft guy",
  "microsoft brandon",
  // Google
  "google uk english male",
  // Chinese male voices
  "kangkang",
  "yunxi",
  "yunjian",
  "yunyang",
];

/** Same idea but for female voices, used when expert is explicitly female and the default is unsuitable. */
const FEMALE_VOICE_HINTS = [
  "female",
  "samantha",
  "karen",
  "moira",
  "tessa",
  "victoria",
  "fiona",
  "microsoft zira",
  "microsoft eva",
  "google us english",
  "google uk english female",
  "xiaoxiao",
  "xiaoyi",
];

function langMatches(voiceLang: string, target: string): boolean {
  if (!voiceLang) return false;
  const vl = voiceLang.toLowerCase();
  const tl = target.toLowerCase();
  return vl === tl || vl.startsWith(`${tl.split("-")[0]}-`) || tl.startsWith(`${vl.split("-")[0]}-`);
}

/**
 * Picks the best `SpeechSynthesisVoice` for the given gender + language.
 * Returns `null` if `speechSynthesis` is unavailable or no voices are loaded
 * yet (caller should let the browser default through in that case).
 */
export function pickDeviceVoice(
  lang: string,
  gender?: string | null,
): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const wantsFemale = isFemaleExpertGender(gender);
  const hints = wantsFemale ? FEMALE_VOICE_HINTS : MALE_VOICE_HINTS;
  const candidates = voices.filter((v) => langMatches(v.lang, lang));
  const pool = candidates.length > 0 ? candidates : voices;

  for (const hint of hints) {
    const match = pool.find((v) => v.name.toLowerCase().includes(hint));
    if (match) return match;
  }

  // Nothing matched explicitly. Return the lang-appropriate default so we at
  // least keep the right language; don't override gender if we can't tell.
  return candidates[0] ?? null;
}

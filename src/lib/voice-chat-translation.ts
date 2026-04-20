export const VOICE_CHAT_TRANSLATION_TARGETS = [
  "english",
  "chinese",
] as const;

export type VoiceChatTranslationTarget =
  (typeof VOICE_CHAT_TRANSLATION_TARGETS)[number];

const CJK_RE = /[\u3400-\u9fff]/;

export function inferVoiceChatTranslationTarget(
  text: string,
): VoiceChatTranslationTarget {
  return CJK_RE.test(text) ? "english" : "chinese";
}

export function getVoiceChatTranslationLabel(
  target: VoiceChatTranslationTarget,
): string {
  return target === "english" ? "English" : "中文";
}

export function getVoiceChatTranslationLanguageName(
  target: VoiceChatTranslationTarget,
): string {
  return target === "english" ? "English" : "Simplified Chinese";
}

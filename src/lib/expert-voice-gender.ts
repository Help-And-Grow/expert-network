/**
 * Map `Expert.gender` (onboarding uses `male` | `female` | `other`) to default TTS voice sex.
 * Case-insensitive so mixed DB rows still behave.
 */
export function isFemaleExpertGender(gender?: string | null): boolean {
  const g = gender?.trim().toLowerCase() ?? "";
  return g === "female" || g === "f" || g === "woman";
}

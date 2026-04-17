/** WeChat / Taro may pass query params as string or string[]. */
export function normalizeRouteId(
  raw: string | string[] | undefined | null,
): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === "string" ? first.trim() : "";
  }
  return String(raw).trim();
}

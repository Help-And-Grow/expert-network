/** Domain-only hint for logs (no full address). */
export function maskEmailForLog(identifier: string): string {
  const at = identifier.lastIndexOf("@");
  if (at <= 0) return "(invalid)";
  return `***@${identifier.slice(at + 1)}`;
}

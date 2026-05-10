import { permanentRedirect } from "next/navigation";

/**
 * Phase 1 admin-page revamp — `/admin/ai-provider` was unified into
 * `/admin/providers?tab=llm`. This shim issues a 308 (permanent) redirect
 * so existing bookmarks and external links keep working.
 */
export default function LegacyAiProviderPage() {
  permanentRedirect("/admin/providers?tab=llm");
}

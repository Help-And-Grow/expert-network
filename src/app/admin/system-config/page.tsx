import { permanentRedirect } from "next/navigation";

/**
 * Phase 1 admin-page revamp — `/admin/system-config` was unified into
 * `/admin/providers?tab=storage`. 308 redirect for legacy bookmarks.
 */
export default function LegacySystemConfigPage() {
  permanentRedirect("/admin/providers?tab=storage");
}

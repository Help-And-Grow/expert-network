import { Suspense } from "react";

import AuditClient from "./audit-client";

/**
 * Full paginated audit log of provider/system-config changes. Filters in
 * URL query string so the back button restores state. Lives under the
 * Providers admin surface so the auth guard is the same `requireAdmin`.
 */
export const dynamic = "force-dynamic";

export default function ProvidersAuditPage() {
  return (
    <Suspense fallback={null}>
      <AuditClient />
    </Suspense>
  );
}

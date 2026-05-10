import { Suspense } from "react";
import ProvidersClient from "./providers-client";

/**
 * Phase 1 unified admin page. Replaces `/admin/ai-provider` and
 * `/admin/system-config`. Three tabs: LLM, Storage, Database.
 */
export const dynamic = "force-dynamic";

export default function AdminProvidersPage() {
  return (
    <Suspense fallback={null}>
      <ProvidersClient />
    </Suspense>
  );
}

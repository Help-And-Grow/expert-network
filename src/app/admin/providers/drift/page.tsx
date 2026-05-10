import { Suspense } from "react";
import DriftClient from "./drift-client";

export const dynamic = "force-dynamic";

export default function DriftPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm">Loading drift…</div>}>
      <DriftClient />
    </Suspense>
  );
}

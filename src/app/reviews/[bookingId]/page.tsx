"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function ReviewPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to meetups list; appreciations are inline on each card
    router.replace("/booking");
  }, [router]);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6">
      <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
    </div>
  );
}

import { type NextRequest, NextResponse } from "next/server";

import { runChargeRemainderCron } from "@/lib/jobs/charge-remainder-cron";

/**
 * Vercel Cron job: charges the remainder for bookings where the session
 * ended more than 24 hours ago and deposit has been paid.
 *
 * Secured by the CRON_SECRET header (automatically set by Vercel).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.CRON_DELEGATED_TO_INNGEST === "1") {
    return NextResponse.json({
      skipped: true,
      reason:
        "CRON_DELEGATED_TO_INNGEST=1 — remainder job runs on Inngest schedule instead.",
    });
  }

  try {
    const result = await runChargeRemainderCron();
    return NextResponse.json({
      processed: result.processed,
      charged: result.charged,
      failed: result.failed,
      manualDue: result.manualDue,
      reminders: result.reminders,
      autoCompleted: result.autoCompleted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/charge-remainder]", message, error);
    return NextResponse.json(
      { error: "Cron job failed", detail: message },
      { status: 500 },
    );
  }
}

import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { chargeRemainderScheduled } from "@/inngest/functions/charge-remainder";
import { pompIssueOnBookingCompleted } from "@/inngest/functions/pomp-issue";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [chargeRemainderScheduled, pompIssueOnBookingCompleted],
});

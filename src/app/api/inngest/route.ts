import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { chargeRemainderScheduled } from "@/inngest/functions/charge-remainder";
import {
  expertEmbeddingRefreshOnProfileChanged,
  expertEmbeddingRefreshStaleScheduled,
} from "@/inngest/functions/expert-embedding-refresh";
import { guestUserReaperScheduled } from "@/inngest/functions/guest-user-reaper";
import { pompIssueOnBookingCompleted } from "@/inngest/functions/pomp-issue";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    chargeRemainderScheduled,
    expertEmbeddingRefreshOnProfileChanged,
    expertEmbeddingRefreshStaleScheduled,
    guestUserReaperScheduled,
    pompIssueOnBookingCompleted,
  ],
});

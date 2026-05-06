import { cron } from "inngest";

import { runGuestUserReaper } from "@/lib/jobs/guest-user-reaper";

import { inngest } from "../client";

/**
 * Phase 4 of the guest-booking rollout
 * (docs/exec-plans/active/guest-booking.md §6).
 *
 * Once-a-week sweep that deletes guest User rows older than a year with
 * zero downstream references — see runGuestUserReaper for the strict
 * "is this row truly orphaned" predicate.
 *
 * Schedule: Mondays at 03:15 UTC (~11:15 SGT). Avoids the daily booking-
 * remainder cron at 00:00 UTC and the AI provider rate-limit reset at 00.
 * Weekly is plenty — orphaned rows aren't time-sensitive.
 */
export const guestUserReaperScheduled = inngest.createFunction(
  {
    id: "guest-user-reaper-scheduled",
    name: "Guest user reaper",
    triggers: [cron("15 3 * * 1")],
  },
  async ({ step }) => {
    return step.run("run-guest-user-reaper", async () => {
      return runGuestUserReaper();
    });
  },
);

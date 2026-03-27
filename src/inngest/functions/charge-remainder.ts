import { cron } from "inngest";

import { runChargeRemainderCron } from "@/lib/jobs/charge-remainder-cron";

import { inngest } from "../client";

/**
 * Same schedule as vercel.json cron by default. When using Inngest as primary,
 * set CRON_DELEGATED_TO_INNGEST=1 and remove or keep Vercel cron (avoid double runs).
 */
export const chargeRemainderScheduled = inngest.createFunction(
  {
    id: "charge-remainder-scheduled",
    name: "Charge booking remainders",
    triggers: [cron("0 0 * * *")],
  },
  async ({ step }) => {
    return step.run("run-charge-remainder-cron", async () => {
      return runChargeRemainderCron();
    });
  },
);

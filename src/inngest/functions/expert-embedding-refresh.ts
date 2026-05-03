import { cron } from "inngest";

import {
  embedExpertProfile,
  refreshStaleExpertProfileEmbeddings,
} from "@/lib/expert-search-embeddings";
import type { ExpertSearchRegion } from "@/lib/expert-search-region";

import { inngest } from "../client";

function parseRegion(value: unknown): ExpertSearchRegion | undefined {
  if (value === "global" || value === "wechat-cn" || value === "wechat-intl") {
    return value;
  }
  return undefined;
}

export const expertEmbeddingRefreshOnProfileChanged = inngest.createFunction(
  {
    id: "expert-embedding-refresh-on-profile-changed",
    name: "Refresh expert profile embedding",
    triggers: [{ event: "app/expert.profile.changed" }],
  },
  async ({ event, step }) => {
    const expertId = (event.data as { expertId?: string }).expertId;
    if (!expertId) {
      throw new Error("app/expert.profile.changed missing expertId");
    }

    const region = parseRegion((event.data as { region?: unknown }).region);
    return step.run("embed-expert-profile", async () =>
      embedExpertProfile(expertId, { region }),
    );
  },
);

export const expertEmbeddingRefreshStaleScheduled = inngest.createFunction(
  {
    id: "expert-embedding-refresh-stale-scheduled",
    name: "Refresh stale expert profile embeddings",
    triggers: [cron("0 3 * * 0")],
  },
  async ({ step }) => {
    return step.run("refresh-stale-expert-profile-embeddings", async () =>
      refreshStaleExpertProfileEmbeddings({
        olderThanDays: 30,
        limit: 100,
      }),
    );
  },
);

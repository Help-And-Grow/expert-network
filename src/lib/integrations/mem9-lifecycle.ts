/**
 * mem9 lifecycle helpers — fire-and-forget memory operations.
 *
 * Each function logs errors but never throws, so calling code can
 * `await` or just fire-and-forget without try/catch.
 */

import { prisma } from "@/lib/prisma";

import { getMemory } from "./config";
import {
  searchExpertMemoryChunks,
  storeExpertMemoryChunk,
} from "./pgvector-memory";

// -----------------------------------------------------------------------
// Space provisioning
// -----------------------------------------------------------------------

/**
 * Ensure an expert has a mem9 space. Creates one if missing,
 * saves the ID on the Expert record, and returns it.
 */
export async function ensureExpertSpace(expertId: string): Promise<string | null> {
  try {
    const memory = await getMemory();
    if (!memory) return null;

    const expert = await prisma.expert.findUnique({
      where: { id: expertId },
      select: { mem9SpaceId: true },
    });

    if (expert?.mem9SpaceId) return expert.mem9SpaceId;

    const spaceId = await memory.createSpace();

    await prisma.expert.update({
      where: { id: expertId },
      data: { mem9SpaceId: spaceId },
    });

    console.log(`[mem9] Provisioned space ${spaceId} for expert ${expertId}`);
    return spaceId;
  } catch (err) {
    console.error("[mem9] ensureExpertSpace failed:", err);
    return null;
  }
}

// -----------------------------------------------------------------------
// Onboarding / profile seeding
// -----------------------------------------------------------------------

export interface ExpertProfileSeed {
  expertId: string;
  nickName: string;
  bio: string;
  domains: string[];
  services: unknown[];
  socialLinks: Record<string, string | null>;
}

/**
 * Store initial profile data as memories when the expert finishes
 * AI generation or publishes their profile.
 */
export async function seedExpertProfile(seed: ExpertProfileSeed): Promise<void> {
  try {
    const memory = await getMemory();
    if (!memory) return;

    const spaceId = await ensureExpertSpace(seed.expertId);
    if (!spaceId) return;

    const source = `expert:${seed.expertId}`;

    const entries: { content: string; tags: string[] }[] = [];

    if (seed.bio) {
      entries.push({
        content: `Professional biography: ${seed.bio}`,
        tags: ["profile", "bio"],
      });
    }

    if (seed.domains.length > 0) {
      entries.push({
        content: `Service domains: ${seed.domains.join(", ")}`,
        tags: ["profile", "domains"],
      });
    }

    if (Array.isArray(seed.services) && seed.services.length > 0) {
      entries.push({
        content: `Services offered: ${JSON.stringify(seed.services)}`,
        tags: ["profile", "services"],
      });
    }

    const activeLinks = Object.entries(seed.socialLinks)
      .filter(([, v]) => !!v)
      .map(([k, v]) => `${k}: ${v}`);
    if (activeLinks.length > 0) {
      entries.push({
        content: `Social/web presence: ${activeLinks.join("; ")}`,
        tags: ["profile", "social"],
      });
    }

    await Promise.all(
      entries.map((e) =>
        memory.store(spaceId, { content: e.content, tags: e.tags, source })
      )
    );

    await Promise.all(
      entries.map((e) =>
        storeExpertMemoryChunk({
          expertId: seed.expertId,
          content: e.content,
          tags: e.tags,
          source,
        })
      )
    );

    console.log(`[mem9] Seeded ${entries.length} profile memories for expert ${seed.expertId}`);
  } catch (err) {
    console.error("[mem9] seedExpertProfile failed:", err);
  }
}

// -----------------------------------------------------------------------
// Booking events
// -----------------------------------------------------------------------

interface BookingEvent {
  expertId: string;
  founderName: string;
  sessionType: string;
  startTime: Date;
  status: string;
}

export async function storeBookingEvent(event: BookingEvent): Promise<void> {
  try {
    const memory = await getMemory();
    if (!memory) return;

    const expert = await prisma.expert.findUnique({
      where: { id: event.expertId },
      select: { mem9SpaceId: true },
    });
    if (!expert?.mem9SpaceId) return;

    const dateStr = event.startTime.toISOString().split("T")[0];
    const content = `Booking: ${event.founderName} booked a ${event.sessionType.toLowerCase()} session on ${dateStr}. Status: ${event.status}.`;
    await memory.store(expert.mem9SpaceId, {
      content,
      tags: ["booking", event.status.toLowerCase()],
      source: `expert:${event.expertId}`,
    });

    await storeExpertMemoryChunk({
      expertId: event.expertId,
      content,
      tags: ["booking", event.status.toLowerCase()],
      source: `expert:${event.expertId}`,
    });

    console.log(`[mem9] Stored booking event for expert ${event.expertId}`);
  } catch (err) {
    console.error("[mem9] storeBookingEvent failed:", err);
  }
}

// -----------------------------------------------------------------------
// Review events
// -----------------------------------------------------------------------

interface ReviewEvent {
  expertId: string;
  founderName: string;
  rating: number;
  comment?: string | null;
}

export async function storeReviewEvent(event: ReviewEvent): Promise<void> {
  try {
    const memory = await getMemory();
    if (!memory) return;

    const expert = await prisma.expert.findUnique({
      where: { id: event.expertId },
      select: { mem9SpaceId: true },
    });
    if (!expert?.mem9SpaceId) return;

    const stars = "★".repeat(event.rating) + "☆".repeat(5 - event.rating);
    const comment = event.comment ? ` Feedback: "${event.comment}"` : "";
    const content = `Client review from ${event.founderName}: ${stars} (${event.rating}/5).${comment}`;
    await memory.store(expert.mem9SpaceId, {
      content,
      tags: ["review", `rating:${event.rating}`],
      source: `expert:${event.expertId}`,
    });

    await storeExpertMemoryChunk({
      expertId: event.expertId,
      content,
      tags: ["review", `rating:${event.rating}`],
      source: `expert:${event.expertId}`,
    });

    console.log(`[mem9] Stored review for expert ${event.expertId}`);
  } catch (err) {
    console.error("[mem9] storeReviewEvent failed:", err);
  }
}

// -----------------------------------------------------------------------
// Memory search (for AI match enrichment)
// -----------------------------------------------------------------------

export async function searchExpertMemories(
  expertId: string,
  query: string,
  limit = 5
): Promise<string[]> {
  try {
    if (process.env.USE_PGVECTOR_MEMORY === "1") {
      const fromPg = await searchExpertMemoryChunks(expertId, query, limit);
      if (fromPg.length > 0) return fromPg;
    }

    const memory = await getMemory();
    if (!memory) return [];

    const expert = await prisma.expert.findUnique({
      where: { id: expertId },
      select: { mem9SpaceId: true },
    });
    if (!expert?.mem9SpaceId) return [];

    const results = await memory.search(expert.mem9SpaceId, query, limit);
    return results.map((r) => r.content);
  } catch (err) {
    console.error("[mem9] searchExpertMemories failed:", err);
    return [];
  }
}

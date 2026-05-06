import { prisma } from "@/lib/prisma";

// This is a background job (no inbound request), so we use plain console.* —
// matches the pattern in src/lib/jobs/charge-remainder-cron.ts. apiLog requires
// a RequestLike and isn't appropriate here.
function jobLog(level: "info" | "warn", event: string, data: Record<string, unknown>): void {
  const line = JSON.stringify({ level, job: "guest-user-reaper", event, ...data });
  if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Phase 4 hardening of the guest-booking flow
 * (docs/exec-plans/active/guest-booking.md §6).
 *
 * The Phase 1 design auto-creates a `User` row keyed by email when a guest
 * books a meetup. Most of those users eventually sign in (PrismaAdapter
 * attaches the OAuth account) — but a tail of them never do, and never
 * book again. After 12+ months those rows are dead weight.
 *
 * This reaper deletes a guest User row only when ALL of these hold:
 *   - createdAt is older than `olderThanDays`
 *   - no OAuth `accounts`
 *   - no active `sessions`
 *   - no `bookingsAsFounder` (any status — kept rows are still referenced)
 *   - not an `Expert`
 *   - no `Membership`
 *   - no `tokenLedger` (i.e. no H&G token activity)
 *   - no `MembershipLedger` (i.e. no purchase history)
 *
 * That set is intentionally strict: it picks up only guest users who
 * created an account via the booking form, never came back, and have
 * zero downstream references. Anyone with even a shred of activity stays.
 *
 * Returns counts so the caller (Inngest function or admin trigger) can
 * surface the number reaped in the run summary.
 */

export interface ReaperResult {
  scanned: number;
  deleted: number;
  cutoffIso: string;
}

const DEFAULT_OLDER_THAN_DAYS = 365;
const DEFAULT_BATCH_SIZE = 100;

export async function runGuestUserReaper(opts?: {
  olderThanDays?: number;
  batchSize?: number;
  /** Set true to log without deleting — useful for the first production run. */
  dryRun?: boolean;
}): Promise<ReaperResult> {
  const olderThanDays = opts?.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const dryRun = !!opts?.dryRun;
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  // The composite "no downstream references" filter. Keeping it as a single
  // findMany ensures we don't reap a row mid-flight that just got a booking.
  const candidates = await prisma.user.findMany({
    where: {
      createdAt: { lt: cutoff },
      accounts: { none: {} },
      sessions: { none: {} },
      bookingsAsFounder: { none: {} },
      expert: null,
      membership: null,
      tokenLedger: { none: {} },
      membershipLedger: { none: {} },
    },
    select: { id: true, email: true, createdAt: true },
    take: batchSize,
  });

  if (candidates.length === 0) {
    jobLog("info", "no_candidates", {
      cutoff: cutoff.toISOString(),
      olderThanDays,
      dryRun,
    });
    return { scanned: 0, deleted: 0, cutoffIso: cutoff.toISOString() };
  }

  if (dryRun) {
    jobLog("info", "dry_run", {
      cutoff: cutoff.toISOString(),
      candidates: candidates.length,
      olderThanDays,
    });
    return {
      scanned: candidates.length,
      deleted: 0,
      cutoffIso: cutoff.toISOString(),
    };
  }

  // Re-check + delete inside one transaction so a freshly-attached `accounts`
  // row or `bookingsAsFounder` insert (between findMany and delete) wins
  // over the reap.
  const ids = candidates.map((c) => c.id);
  const result = await prisma.user.deleteMany({
    where: {
      id: { in: ids },
      accounts: { none: {} },
      sessions: { none: {} },
      bookingsAsFounder: { none: {} },
      expert: null,
      membership: null,
      tokenLedger: { none: {} },
      membershipLedger: { none: {} },
    },
  });

  jobLog("info", "deleted", {
    cutoff: cutoff.toISOString(),
    scanned: candidates.length,
    deleted: result.count,
    sampleIds: candidates.slice(0, 3).map((c) => c.id),
  });

  return {
    scanned: candidates.length,
    deleted: result.count,
    cutoffIso: cutoff.toISOString(),
  };
}

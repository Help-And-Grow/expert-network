import { createHash } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { prismaFull as prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Tencent TRTC server callback (RTC基础回调).
 *
 * Console: 实时音视频 TRTC → 应用管理 → 选择应用 → 回调配置 → RTC基础回调
 * Configured callback URL must match this route. Only the **房间回调**
 * (Room Callback) field is used today; the rest stay empty.
 *
 * Auth: Tencent appends `sdkappid`, `callbacktime`, `contenttype`, `sign` as
 * query parameters. `sign = MD5(callbackkey + callbacktime)` (lowercase hex).
 * Some console regions still document the legacy form
 * `MD5(sdkappid + callbackkey + callbacktime)` — we accept either to stay
 * compatible with both. Without `TRTC_CALLBACK_KEY` set we refuse all
 * callbacks (no anonymous webhook entry).
 *
 * Events we act on (EventGroupId = 1, room events):
 *  - 101 — Room created (first user joined)        → record start time
 *  - 102 — Room dissolved (last user left)         → write `liveDurationMinutes`
 *  - 103 — Member entered (per user)               → ignored, observability only
 *  - 104 — Member exited (per user)                → ignored, observability only
 *
 * The room start time is held in-process between 101 and 102 events because we
 * don't have a `liveRoomStartedAt` Prisma column yet. If the serverless
 * instance is recycled between events, we fall back to `booking.startTime` as
 * a proxy — the duration is then approximate (slightly over-stated by at most
 * the 15-min prejoin window). A future migration can promote this to a real
 * column for exact tracking.
 */

type TrtcCallbackBody = {
  EventGroupId?: number;
  EventType?: number;
  CallbackTs?: number;
  EventInfo?: {
    RoomId?: number | string;
    EventTime?: number;
    UserId?: string;
    Reason?: number;
  };
};

const ROOM_CREATED = 101;
const ROOM_DISSOLVED = 102;
const MEMBER_ENTERED = 103;
const MEMBER_EXITED = 104;

// Process-local cache of room creation timestamps (seconds, Tencent native).
// Keyed by stringified RoomId. Bounded to avoid leaks on long-running
// processes; in serverless this resets on every cold start.
const ROOM_STARTED_AT = new Map<string, number>();
const ROOM_CACHE_MAX = 500;

function rememberRoomStart(roomId: string, eventTimeSec: number) {
  if (ROOM_STARTED_AT.size >= ROOM_CACHE_MAX) {
    const firstKey = ROOM_STARTED_AT.keys().next().value;
    if (firstKey !== undefined) ROOM_STARTED_AT.delete(firstKey);
  }
  ROOM_STARTED_AT.set(roomId, eventTimeSec);
}

function md5Hex(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function verifySignature(url: URL, key: string): boolean {
  // Tencent uses lowercase query param names, but accept both for safety.
  const sign = (url.searchParams.get("sign") ?? url.searchParams.get("Sign") ?? "").toLowerCase();
  const callbackTs =
    url.searchParams.get("callbacktime") ?? url.searchParams.get("CallbackTs") ?? "";
  const sdkAppId =
    url.searchParams.get("sdkappid") ?? url.searchParams.get("SDKAppID") ?? "";

  if (!sign || !callbackTs) return false;

  const candidates = [
    md5Hex(`${key}${callbackTs}`),
    md5Hex(`${sdkAppId}${key}${callbackTs}`),
  ];
  return candidates.some((expected) => timingSafeEq(sign, expected));
}

export async function POST(request: NextRequest) {
  const callbackKey = env.TRTC_CALLBACK_KEY;
  if (!callbackKey) {
    console.warn("[trtc/webhook] TRTC_CALLBACK_KEY is not set — refusing callback.");
    return NextResponse.json({ code: 1, message: "callback key not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  if (!verifySignature(url, callbackKey)) {
    console.warn("[trtc/webhook] signature verification failed", {
      query: url.search,
    });
    return NextResponse.json({ code: 1, message: "invalid signature" }, { status: 403 });
  }

  let body: TrtcCallbackBody;
  try {
    body = (await request.json()) as TrtcCallbackBody;
  } catch (error) {
    console.warn("[trtc/webhook] invalid JSON body", error);
    return NextResponse.json({ code: 1, message: "invalid json" }, { status: 400 });
  }

  const eventType = Number(body.EventType ?? 0);
  const info = body.EventInfo ?? {};
  const roomId = info.RoomId !== undefined ? String(info.RoomId) : "";
  const eventTimeSec = Number(info.EventTime ?? 0);

  if (!roomId || !eventTimeSec) {
    // Tencent expects 200 + {code:0} for callbacks it should not retry.
    return NextResponse.json({ code: 0, message: "ignored: missing roomId or eventTime" });
  }

  try {
    switch (eventType) {
      case ROOM_CREATED: {
        rememberRoomStart(roomId, eventTimeSec);
        break;
      }

      case ROOM_DISSOLVED: {
        const booking = await prisma.booking.findFirst({
          where: { liveRoomId: roomId },
          select: {
            id: true,
            startTime: true,
            liveDurationMinutes: true,
          },
        });

        if (!booking) {
          console.warn("[trtc/webhook] room dissolved but no booking matched", { roomId });
          break;
        }

        // Skip if already recorded (Tencent retries on transient errors).
        if (booking.liveDurationMinutes !== null && booking.liveDurationMinutes !== undefined) {
          break;
        }

        const startedAtSec =
          ROOM_STARTED_AT.get(roomId) ??
          Math.floor(booking.startTime.getTime() / 1000);

        const durationSec = Math.max(0, eventTimeSec - startedAtSec);
        const durationMin = Math.round(durationSec / 60);

        await prisma.booking.update({
          where: { id: booking.id },
          data: { liveDurationMinutes: durationMin },
        });

        ROOM_STARTED_AT.delete(roomId);
        break;
      }

      case MEMBER_ENTERED:
      case MEMBER_EXITED: {
        // Observability hook — no-op for now. Phase 5.1 can persist these to
        // a TRTC event table for analytics if needed.
        break;
      }

      default: {
        // Unrecognized event types are not retried.
        break;
      }
    }
  } catch (error) {
    console.error("[trtc/webhook] handler error", error, {
      eventType,
      roomId,
    });
    // Returning non-zero asks Tencent to retry — only do this for genuine
    // transient errors. Database errors qualify.
    return NextResponse.json({ code: 1, message: "internal error" }, { status: 500 });
  }

  return NextResponse.json({ code: 0, message: "OK" });
}

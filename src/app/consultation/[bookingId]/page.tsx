"use client";

/**
 * Premium live consultation — web client.
 *
 * Flow:
 *   1. Mount → POST /api/trtc/token { bookingId } to get sdkAppId / roomId /
 *      userId / userSig and the booking-scoped expiry.
 *   2. Initialize trtc-sdk-v5, attach local audio + camera tracks to the
 *      "self" video element.
 *   3. Subscribe to remote-user events; when the other participant joins,
 *      attach their stream to the "remote" video element.
 *   4. Provide mic / camera / leave controls. Leaving routes back to the
 *      booking dashboard.
 *
 * Backend handles ownership, premium-flag, time-window, and the booking-
 * scoped credit debit before any UserSig is minted (see
 * src/app/api/trtc/token/route.ts).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import {
  ArrowLeft,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { getTelegramInitData } from "@/lib/telegram";

type TokenResponse = {
  sdkAppId: number;
  roomId: number;
  userId: string;
  userSig: string;
  expiresInSeconds: number;
  expiresAt: string;
  participantRole: "founder" | "expert";
  // Optional / removed: premiumLiveTokenCost. Premium live is now membership-
  // gated (WeChat-MP-only); the per-room H&G token debit no longer applies.
  premiumLiveTokenCost?: number;
};

type RoomState = "loading" | "ready" | "joining" | "in-room" | "leaving" | "error";

type RemoteUser = { userId: string; hasVideo: boolean; hasAudio: boolean };

const SELF_VIDEO_ID = "self-video";
const REMOTE_STREAM_VIEW_PREFIX = "remote-video-";

export default function ConsultationPage() {
  const params = useParams();
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const bookingId = params.bookingId as string;

  const [state, setState] = useState<RoomState>("loading");
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);

  // The TRTC client instance is held in a ref so re-renders don't recreate it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trtcClientRef = useRef<any>(null);

  const fetchToken = useCallback(async () => {
    if (!bookingId) return;
    setState("loading");
    setError(null);
    try {
      const initData = getTelegramInitData();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (initData) headers["x-telegram-init-data"] = initData;

      const res = await fetch("/api/trtc/token", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ bookingId }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | TokenResponse
        | { error?: string };
      if (!res.ok || !("sdkAppId" in body)) {
        throw new Error(("error" in body && body.error) || "Failed to issue room credentials.");
      }
      setToken(body);
      setState("ready");
    } catch (err) {
      console.error("[consultation] token fetch failed", err);
      setError(err instanceof Error ? err.message : "Failed to load consultation room.");
      setState("error");
    }
  }, [bookingId]);

  useEffect(() => {
    if (authStatus === "loading") return;
    if (authStatus === "unauthenticated") {
      const callback = `/consultation/${bookingId}`;
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(callback)}`);
      return;
    }
    void fetchToken();
  }, [authStatus, bookingId, fetchToken, router]);

  const joinRoom = useCallback(async () => {
    if (!token) return;
    setState("joining");
    setError(null);
    try {
      // Lazy-load the SDK so the page bundle stays light for users who never
      // open a live consultation.
      const TRTC = (await import("trtc-sdk-v5")).default;
      const client = TRTC.create();
      trtcClientRef.current = client;

      client.on(TRTC.EVENT.REMOTE_USER_ENTER, ({ userId }: { userId: string }) => {
        setRemoteUsers((prev) =>
          prev.some((u) => u.userId === userId)
            ? prev
            : [...prev, { userId, hasVideo: false, hasAudio: false }],
        );
      });
      client.on(TRTC.EVENT.REMOTE_USER_EXIT, ({ userId }: { userId: string }) => {
        setRemoteUsers((prev) => prev.filter((u) => u.userId !== userId));
      });
      client.on(
        TRTC.EVENT.REMOTE_VIDEO_AVAILABLE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async ({ userId, streamType }: { userId: string; streamType: any }) => {
          await client.startRemoteVideo({
            userId,
            streamType,
            view: `${REMOTE_STREAM_VIEW_PREFIX}${userId}`,
          });
          setRemoteUsers((prev) =>
            prev.map((u) => (u.userId === userId ? { ...u, hasVideo: true } : u)),
          );
        },
      );
      client.on(TRTC.EVENT.REMOTE_VIDEO_UNAVAILABLE, ({ userId }: { userId: string }) => {
        setRemoteUsers((prev) =>
          prev.map((u) => (u.userId === userId ? { ...u, hasVideo: false } : u)),
        );
      });
      client.on(TRTC.EVENT.REMOTE_AUDIO_AVAILABLE, ({ userId }: { userId: string }) => {
        setRemoteUsers((prev) =>
          prev.map((u) => (u.userId === userId ? { ...u, hasAudio: true } : u)),
        );
      });
      client.on(TRTC.EVENT.REMOTE_AUDIO_UNAVAILABLE, ({ userId }: { userId: string }) => {
        setRemoteUsers((prev) =>
          prev.map((u) => (u.userId === userId ? { ...u, hasAudio: false } : u)),
        );
      });
      client.on(TRTC.EVENT.KICKED_OUT, ({ reason }: { reason: string }) => {
        console.warn("[consultation] kicked out", reason);
        setError(`Disconnected: ${reason}`);
        setState("error");
      });

      await client.enterRoom({
        roomId: token.roomId,
        sdkAppId: token.sdkAppId,
        userId: token.userId,
        userSig: token.userSig,
      });

      await client.startLocalVideo({ view: SELF_VIDEO_ID });
      await client.startLocalAudio();

      setState("in-room");
    } catch (err) {
      console.error("[consultation] join failed", err);
      setError(err instanceof Error ? err.message : "Failed to join the room.");
      setState("error");
      // Best-effort cleanup on partial join.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = trtcClientRef.current as any;
      if (client) {
        try {
          await client.exitRoom();
        } catch {
          /* ignore */
        }
        trtcClientRef.current = null;
      }
    }
  }, [token]);

  const toggleMic = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = trtcClientRef.current as any;
    if (!client) return;
    try {
      if (muted) {
        await client.startLocalAudio();
      } else {
        await client.stopLocalAudio();
      }
      setMuted((v) => !v);
    } catch (err) {
      console.error("[consultation] mic toggle failed", err);
    }
  }, [muted]);

  const toggleCamera = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = trtcClientRef.current as any;
    if (!client) return;
    try {
      if (cameraOff) {
        await client.startLocalVideo({ view: SELF_VIDEO_ID });
      } else {
        await client.stopLocalVideo();
      }
      setCameraOff((v) => !v);
    } catch (err) {
      console.error("[consultation] camera toggle failed", err);
    }
  }, [cameraOff]);

  const leaveRoom = useCallback(async () => {
    setState("leaving");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = trtcClientRef.current as any;
    if (client) {
      try {
        await client.exitRoom();
      } catch (err) {
        console.warn("[consultation] exit room failed", err);
      }
      trtcClientRef.current = null;
    }
    router.push("/booking");
  }, [router]);

  // Cleanup on unmount: always exit the room so the SCF token doesn't have a
  // ghost participant counted against the booking-scoped quota.
  useEffect(() => {
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = trtcClientRef.current as any;
      if (client) {
        client.exitRoom().catch(() => {});
        trtcClientRef.current = null;
      }
    };
  }, []);

  if (!bookingId) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-muted-foreground">
        Invalid booking ID
      </div>
    );
  }

  if (state === "loading" || authStatus === "loading") {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 gap-4">
        <h1 className="text-xl font-semibold">Live consultation unavailable</h1>
        <p className="text-center text-sm text-muted-foreground max-w-md">
          {error ?? "Unknown error."}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/booking">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to meetups
            </Link>
          </Button>
          <Button onClick={fetchToken}>Try again</Button>
        </div>
      </div>
    );
  }

  // Pre-join: token loaded, awaiting user to start.
  if (state === "ready" && token) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 gap-6">
        <div className="text-center max-w-md space-y-2">
          <h1 className="text-2xl font-semibold">Premium live consultation</h1>
          <p className="text-sm text-muted-foreground">
            Joining as <span className="font-medium">{token.participantRole}</span>.
            The room closes at{" "}
            <span className="font-medium">
              {new Date(token.expiresAt).toLocaleString()}
            </span>
            .
          </p>
          {/* Premium-live H&G token cost message removed — feature is membership-gated. */}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/booking">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Cancel
            </Link>
          </Button>
          <Button onClick={joinRoom} className="bg-indigo-600 hover:bg-indigo-700">
            <Video className="mr-2 h-4 w-4" />
            Join now
          </Button>
        </div>
      </div>
    );
  }

  if (state === "joining" || state === "leaving") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        <p className="text-sm text-muted-foreground">
          {state === "joining" ? "Joining room..." : "Leaving..."}
        </p>
      </div>
    );
  }

  // In-room layout.
  return (
    <div className="min-h-dvh flex flex-col bg-slate-950 text-white">
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 p-2">
        <div className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden">
          <div id={SELF_VIDEO_ID} className="absolute inset-0 [&>video]:object-cover [&>video]:w-full [&>video]:h-full" />
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs">
            You
          </span>
          {cameraOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 text-sm text-slate-400">
              Camera off
            </div>
          )}
        </div>
        {remoteUsers.length === 0 ? (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-900 text-sm text-slate-400">
            Waiting for the other participant...
          </div>
        ) : (
          remoteUsers.map((user) => (
            <div
              key={user.userId}
              className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden"
            >
              <div
                id={`${REMOTE_STREAM_VIEW_PREFIX}${user.userId}`}
                className="absolute inset-0 [&>video]:object-cover [&>video]:w-full [&>video]:h-full"
              />
              <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs">
                {user.userId.split("_")[0] || user.userId}
              </span>
              {!user.hasVideo && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 text-sm text-slate-400">
                  Video off
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-slate-800 bg-slate-900/95 p-4">
        <div className="mx-auto flex max-w-md items-center justify-center gap-3">
          <Button
            onClick={toggleMic}
            variant="outline"
            size="icon"
            className="h-12 w-12 rounded-full border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Button>
          <Button
            onClick={toggleCamera}
            variant="outline"
            size="icon"
            className="h-12 w-12 rounded-full border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
          >
            {cameraOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
          </Button>
          <Button
            onClick={leaveRoom}
            size="icon"
            className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700"
          >
            <PhoneOff className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

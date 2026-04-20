import { createHash, createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";

import { env } from "@/lib/env";

export type TrtcParticipantRole = "founder" | "expert";

const ROOM_ID_MAX = 2_147_483_647;
const DEFAULT_PREMIUM_LIVE_TOKENS = 0;
const DEFAULT_PREJOIN_SECONDS = 15 * 60;
const DEFAULT_POST_END_GRACE_SECONDS = 15 * 60;

function base64UrlEscape(value: string): string {
  return value.replace(/\+/g, "*").replace(/\//g, "-").replace(/=/g, "_");
}

function normalizeIdFragment(value: string, fallback: string, maxLength: number): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, "").slice(-maxLength);
  return normalized || fallback;
}

export function isTrtcConfigured(): boolean {
  return Boolean(Number(env.TRTC_APP_ID) > 0 && (env.TRTC_SECRET_KEY || env.TRTC_APP_SECRET));
}

export function getTrtcConfig() {
  const appId = Number(env.TRTC_APP_ID);
  const secretKey = env.TRTC_SECRET_KEY ?? env.TRTC_APP_SECRET;
  if (!appId || !secretKey) {
    throw new Error("TRTC is not configured. Set TRTC_APP_ID and TRTC_SECRET_KEY.");
  }

  return {
    appId,
    secretKey,
    premiumLiveTokens: Math.max(0, Number(env.TRTC_PREMIUM_LIVE_TOKENS ?? DEFAULT_PREMIUM_LIVE_TOKENS)),
    prejoinSeconds: Math.max(0, Number(env.TRTC_PREJOIN_SECONDS ?? DEFAULT_PREJOIN_SECONDS)),
    postEndGraceSeconds: Math.max(0, Number(env.TRTC_POST_END_GRACE_SECONDS ?? DEFAULT_POST_END_GRACE_SECONDS)),
  };
}

export function buildTrtcParticipantId(params: {
  bookingId: string;
  userId: string;
  role: TrtcParticipantRole;
}): string {
  const bookingPart = normalizeIdFragment(params.bookingId, "booking", 10);
  const userPart = normalizeIdFragment(params.userId, "user", 12);
  const rolePrefix = params.role === "founder" ? "founder" : "expert";
  return `${rolePrefix}_${bookingPart}_${userPart}`;
}

export function buildTrtcRoomIdCandidate(bookingId: string, attempt = 0): string {
  const digest = createHash("sha256")
    .update(`${bookingId}:${attempt}`, "utf8")
    .digest();
  const raw = digest.readUInt32BE(0) % ROOM_ID_MAX;
  return String(raw + 1);
}

export function getTrtcWindow(startTime: Date, endTime: Date, now = new Date()) {
  const { prejoinSeconds, postEndGraceSeconds } = getTrtcConfig();
  const opensAt = new Date(startTime.getTime() - prejoinSeconds * 1000);
  const closesAt = new Date(endTime.getTime() + postEndGraceSeconds * 1000);
  const expiresInSeconds = Math.max(60, Math.ceil((closesAt.getTime() - now.getTime()) / 1000));

  return {
    opensAt,
    closesAt,
    expiresAt: closesAt,
    expiresInSeconds,
    isTooEarly: now.getTime() < opensAt.getTime(),
    isExpired: now.getTime() > closesAt.getTime(),
  };
}

export function generateTrtcUserSig(userId: string, expireSeconds: number): string {
  const { appId, secretKey } = getTrtcConfig();
  const issuedAt = Math.floor(Date.now() / 1000);
  const contentToBeSigned = [
    `TLS.identifier:${userId}`,
    `TLS.sdkappid:${appId}`,
    `TLS.time:${issuedAt}`,
    `TLS.expire:${expireSeconds}`,
    "",
  ].join("\n");

  const signature = createHmac("sha256", secretKey).update(contentToBeSigned).digest("base64");
  const payload = {
    "TLS.ver": "2.0",
    "TLS.identifier": userId,
    "TLS.sdkappid": appId,
    "TLS.time": issuedAt,
    "TLS.expire": expireSeconds,
    "TLS.sig": signature,
  };

  return base64UrlEscape(deflateSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64"));
}

import { RtcTokenBuilder, RtcRole } from "agora-token";

const PRIVILEGE_EXPIRATION_SECONDS = 600; // 10 min (covers 5-min call + buffer)

export function generateRtcToken(
  channelName: string,
  uid: number,
): string {
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate) {
    throw new Error("AGORA_APP_ID and AGORA_APP_CERTIFICATE must be set");
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + PRIVILEGE_EXPIRATION_SECONDS;

  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs,
    privilegeExpiredTs,
  );
}

/**
 * Keep booking/checkout payloads aligned between web, WeChat, and the API.
 * Import from `@expert-network/shared-api` in the Next app; add the same
 * `file:../packages/shared-api` dependency in `wechat/package.json` when ready.
 */

/** Common JSON error shape from `NextResponse.json({ error, detail? })`. */
export type ApiErrorJson = {
  error: string;
  detail?: string;
};

/** Body for POST /api/bookings (create booking). */
export type CreateBookingBody = {
  expertId: string;
  sessionType: "ONLINE" | "OFFLINE" | "BOTH";
  startTime: string;
  endTime: string;
  timezone?: string;
  meetingLink?: string;
  offlineAddress?: string;
};

/** Capability contract exposed by public expert profile surfaces. */
export type ExperienceCapabilities = {
  voiceIntroAvailable: boolean;
  voiceConsult: {
    enabled: boolean;
    freeReplyLimit: number;
    groupedDrafts: boolean;
    replyStyle: string;
  };
  realtimeVoice: {
    enabled: boolean;
    availableNow: boolean;
    premiumOnly: boolean;
    durationSeconds: number;
  };
  web: {
    publicProfileUrl: string;
    loginFirstProfileUrl: string;
  };
};

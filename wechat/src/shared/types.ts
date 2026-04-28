import type { ApiErrorJson, CreateBookingBody } from "@expert-network/shared-api";

/** Re-export API contract types shared with the Next.js app (`packages/shared-api`). */
export type { ApiErrorJson, CreateBookingBody };

export interface ExpertUser {
  id: string;
  name: string | null;
  nickName: string | null;
  image: string | null;
}

export interface ExperienceCapabilities {
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
}

export interface Expert {
  id: string;
  domains: string[];
  sessionType: string;
  bio: string | null;
  isVerified: boolean;
  avgRating: number;
  reviewCount: number;
  priceOnlineCents: number | null;
  priceOfflineCents: number | null;
  currency: string;
  user: ExpertUser;
}

export interface ExpertDetail extends Expert {
  servicesOffered: ServiceItem[] | null;
  hasAvatar: boolean;
  hasAudio: boolean;
  hasClonedVoice: boolean;
  /** When true, show AI voice chat (default true; uses clone or built-in voice). */
  hasVoiceChat?: boolean;
  viewerIsOwner?: boolean;
  avatarScript: string | null;
  documentName: string | null;
  experienceCapabilities?: ExperienceCapabilities;
}

export interface ServiceItem {
  title: string;
  description: string;
}

export interface ExpertsResponse {
  experts: Expert[];
  total: number;
  skip: number;
  take: number;
}

export interface MatchRecommendation {
  expertId: string;
  name: string;
  /** Short summary of the expert (bio snippet). Preferred for the card. */
  summary?: string;
  /** AI-generated rationale for why this expert matches the query. */
  reason: string;
  sessionTypes: string[];
}

export interface MatchResponse {
  recommendations: MatchRecommendation[];
  noMatchMessage?: string;
}

export interface ReviewFounder {
  id: string;
  name: string | null;
  nickName: string | null;
  image: string | null;
}

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  founder: ReviewFounder;
}

export interface ReviewsResponse {
  reviews: Review[];
  total: number;
  skip: number;
  take: number;
}

export interface AuthUser {
  id: string;
  name: string | null;
  nickName: string | null;
  image: string | null;
  role: string;
  email: string | null;
}

export interface Booking {
  id: string;
  expertId: string;
  founderId: string;
  sessionType: string;
  startTime: string;
  endTime: string;
  timezone: string;
  meetingLink: string | null;
  offlineAddress: string | null;
  status: string;
  totalAmountCents: number | null;
  depositAmountCents: number | null;
  currency: string;
  paymentMethod: string | null;
  paymentStatus: string;
  expert: {
    id: string;
    user: ExpertUser;
    domains: string[];
  };
  founder: ExpertUser;
  review?: {
    id: string;
    rating: number;
    comment: string | null;
    expertSuggestion: string | null;
    suggestionAt: string | null;
    createdAt: string;
  } | null;
}

export interface BookingsResponse {
  bookings: Booking[];
}

export interface AvailableSlot {
  id: string;
  startTime: string;
  endTime: string;
  isBooked: boolean;
}

export const DOMAINS = [
  "Marketing & BD",
  "Headhunter",
  "Law",
  "Funding",
] as const;

export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABELS: Record<string, string> = {
  "Marketing & BD": "市场与商务拓展",
  Headhunter: "招聘与猎头",
  Law: "法律与合规",
  Funding: "融资与资本",
  ONLINE: "线上",
  OFFLINE: "线下",
  BOTH: "线上 + 线下",
};

export function getDomainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] || domain;
}

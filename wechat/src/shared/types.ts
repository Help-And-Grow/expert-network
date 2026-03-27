import type { ApiErrorJson, CreateBookingBody } from "@expert-network/shared-api";

/** Re-export API contract types shared with the Next.js app (`packages/shared-api`). */
export type { ApiErrorJson, CreateBookingBody };

export interface ExpertUser {
  id: string;
  name: string | null;
  nickName: string | null;
  image: string | null;
  email: string | null;
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
  linkedIn: string | null;
  website: string | null;
  twitter: string | null;
  substack: string | null;
  instagram: string | null;
  xiaohongshu: string | null;
  hasAvatar: boolean;
  hasAudio: boolean;
  avatarScript: string | null;
  documentName: string | null;
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

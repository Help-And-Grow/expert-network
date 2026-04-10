export const DOMAINS = [
  "Marketing & BD",
  "Headhunter",
  "Law",
  "Funding",
] as const;

export type Domain = (typeof DOMAINS)[number];

export const SESSION_TYPES = ["ONLINE", "OFFLINE", "BOTH"] as const;

export const ONBOARDING_STEPS = [
  { key: "profile", label: "Profile" },
  { key: "services", label: "Services" },
  { key: "review", label: "Overview" },
  { key: "publish", label: "Publish" },
] as const;

export const SOCIAL_PLATFORMS = [
  { key: "linkedIn", label: "LinkedIn", placeholder: "https://linkedin.com/in/yourprofile", required: true },
  { key: "website", label: "Official Website", placeholder: "https://yourwebsite.com", required: false },
  { key: "twitter", label: "X (Twitter)", placeholder: "https://x.com/yourhandle", required: false },
  { key: "substack", label: "Substack", placeholder: "https://yourname.substack.com", required: false },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/yourhandle", required: false },
  { key: "xiaohongshu", label: "XiaoHongShu", placeholder: "Your XiaoHongShu profile link", required: false },
] as const;

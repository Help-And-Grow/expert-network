import type { MembershipTier } from "@/generated/prisma/client";

/**
 * Membership tier × billing-cycle catalog. Prices are in the smallest unit
 * of `currency` (CNY fen / HKD cents / USD cents) so they pair directly with
 * WeChat Pay's `amount.total` field.
 *
 * Each plan has a stable `id` (`{tier}_{cycle}_{currency}`) used as the
 * `out_trade_no` prefix for WeChat Pay orders, so the webhook can route a
 * `TRANSACTION.SUCCESS` event back to the right tier without consulting the
 * database first.
 */

export type BillingCycle = "monthly" | "yearly";

export type MembershipPlan = {
  id: string;
  tier: Exclude<MembershipTier, "NONE">;
  cycle: BillingCycle;
  durationDays: number;
  priceMinor: number;
  currency: "CNY" | "HKD" | "USD";
  /** Short label shown in UI, e.g. "BASIC · 月卡". */
  label: string;
  /** Human-readable description, e.g. "无限制 1:1 直播咨询，每月可续费". */
  description: string;
};

/** 1 month = 30 days, 1 year = 365 days. Round numbers, no leap-year pedantry. */
const MONTHLY_DAYS = 30;
const YEARLY_DAYS = 365;

export const MEMBERSHIP_PLANS_CN: MembershipPlan[] = [
  {
    id: "BASIC_monthly_CNY",
    tier: "BASIC",
    cycle: "monthly",
    durationDays: MONTHLY_DAYS,
    priceMinor: 9900, // ¥99
    currency: "CNY",
    label: "BASIC · 月卡",
    description: "高清直播咨询，30 天有效",
  },
  {
    id: "BASIC_yearly_CNY",
    tier: "BASIC",
    cycle: "yearly",
    durationDays: YEARLY_DAYS,
    priceMinor: 89900, // ¥899
    currency: "CNY",
    label: "BASIC · 年卡",
    description: "高清直播咨询，365 天有效（约 ¥75 / 月）",
  },
  {
    id: "PRO_monthly_CNY",
    tier: "PRO",
    cycle: "monthly",
    durationDays: MONTHLY_DAYS,
    priceMinor: 29900, // ¥299
    currency: "CNY",
    label: "PRO · 月卡",
    description: "高清直播咨询 + 优先排期，30 天有效",
  },
  {
    id: "PRO_yearly_CNY",
    tier: "PRO",
    cycle: "yearly",
    durationDays: YEARLY_DAYS,
    priceMinor: 239900, // ¥2399
    currency: "CNY",
    label: "PRO · 年卡",
    description: "高清直播咨询 + 优先排期，365 天有效（约 ¥200 / 月）",
  },
];

/** Lookup a plan by its public id. Returns null when the id is unknown. */
export function findPlanById(id: string): MembershipPlan | null {
  return MEMBERSHIP_PLANS_CN.find((plan) => plan.id === id) ?? null;
}

/**
 * Build a `out_trade_no` value for a WeChat Pay order. Format:
 *   m_{planId}_{userIdSuffix}_{millis}
 * Length stays under WeChat Pay's 32-char limit by truncating each part.
 * The `m_` prefix lets the webhook distinguish membership orders from
 * booking orders (which use the booking cuid directly).
 */
export function buildMembershipOutTradeNo(planId: string, userId: string): string {
  const safePlanId = planId.replace(/[^A-Za-z0-9]/g, "");
  const userSuffix = userId.replace(/[^A-Za-z0-9]/g, "").slice(-8);
  const millis = Date.now().toString(36);
  return `m_${safePlanId.slice(0, 14)}_${userSuffix}_${millis}`.slice(0, 32);
}

/** True when an out_trade_no came from `buildMembershipOutTradeNo`. */
export function isMembershipOutTradeNo(outTradeNo: string): boolean {
  return outTradeNo.startsWith("m_");
}

/**
 * Decode the plan id from a membership out_trade_no. Returns null when the
 * value doesn't match the expected shape.
 */
export function parseMembershipOutTradeNo(
  outTradeNo: string,
): { plan: MembershipPlan } | null {
  if (!isMembershipOutTradeNo(outTradeNo)) return null;
  const parts = outTradeNo.split("_");
  if (parts.length < 4) return null;
  // We can't recover the original separators, so reverse-match by trying
  // each known plan id as a prefix-stripped lookup.
  for (const plan of MEMBERSHIP_PLANS_CN) {
    const safe = plan.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 14);
    if (parts[1] === safe) return { plan };
  }
  return null;
}

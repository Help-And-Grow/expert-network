import {
  getWeChatRegion,
  isWeChatOriginatedRequest,
  type HeaderBearingRequest,
} from "@/lib/request-origin";

export type ExpertSearchRegion = "global" | "wechat-cn" | "wechat-intl";

export function resolveExpertSearchRegion(
  request?: HeaderBearingRequest | null,
): ExpertSearchRegion {
  if (!isWeChatOriginatedRequest(request ?? null)) return "global";
  return getWeChatRegion(request ?? null) === "cn"
    ? "wechat-cn"
    : "wechat-intl";
}

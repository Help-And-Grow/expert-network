import type { NextRequest } from "next/server";

import { env } from "@/lib/env";
import {
  isWeChatOriginatedRequest,
  getWeChatRegion,
} from "@/lib/request-origin";
import { getSystemConfig } from "@/lib/system-config";
import type { StorageProvider, StorageProviderName } from "./types";

type StorageContext = {
  /** When set and the request is WeChat-originated, the factory routes to Tencent COS. */
  request?: Pick<NextRequest, "headers"> | null;
};

/**
 * Factory to get the active storage provider.
 * Async because it reads from SystemConfig database first.
 *
 * Pass `{ request }` from a route handler to opt into regional auto-routing:
 * WeChat-originated traffic (stamped by the TCB proxy) goes to Tencent COS
 * regardless of the configured default — when COS is configured.
 */
export async function getStorageProvider(
  ctx: StorageContext = {},
): Promise<StorageProvider> {
  const dbProvider = (await getSystemConfig("STORAGE_PROVIDER")) as StorageProviderName | null;
  let providerName: StorageProviderName = dbProvider || env.STORAGE_PROVIDER || "db";

  // Phase 3: consult ProviderRoutingScope (category=storage) first, fall back
  // to the legacy WeChat→Tencent COS auto-route. The auto-route below stays
  // as a safety net for cold starts before the routing scope rows are seeded.
  const isWeChat = isWeChatOriginatedRequest(ctx.request ?? null);
  const region = getWeChatRegion(ctx.request ?? null);
  try {
    const { resolveChainForRequest } = await import("@/lib/ai/routing");
    const resolved = await resolveChainForRequest(
      "storage",
      { isWeChat, region: region ?? undefined },
      null,
      { fallback: async () => [] },
    );
    if (resolved.length > 0) {
      const candidate = resolved[0] as StorageProviderName;
      if (
        candidate === "vercel" ||
        candidate === "gcs" ||
        candidate === "tencent-cos" ||
        candidate === "db"
      ) {
        providerName = candidate;
      }
    }
  } catch {
    // fall through to legacy logic below
  }

  if (
    providerName !== "tencent-cos" &&
    isWeChat &&
    env.TENCENT_COS_SECRET_ID &&
    env.TENCENT_COS_SECRET_KEY &&
    env.TENCENT_COS_BUCKET &&
    env.TENCENT_COS_REGION
  ) {
    providerName = "tencent-cos";
  }

  switch (providerName) {
    case "vercel":
      const { VercelBlobStorageProvider } = await import("./vercel-blob");
      return new VercelBlobStorageProvider();
    case "gcs":
      const { GoogleCloudStorageProvider } = await import("./gcs");
      return new GoogleCloudStorageProvider();
    case "tencent-cos":
      const { TencentCOSStorageProvider } = await import("./tencent-cos");
      return new TencentCOSStorageProvider();
    case "db":
    default:
      const { DatabaseStorageProvider } = await import("./db-legacy");
      return new DatabaseStorageProvider();
  }
}

export async function getActiveStorageProviderName(): Promise<StorageProviderName> {
  const dbProvider = (await getSystemConfig("STORAGE_PROVIDER")) as StorageProviderName | null;
  return dbProvider || env.STORAGE_PROVIDER || "db";
}

/**
 * Registry-first list of enabled storage providers (Phase 1 admin revamp).
 * Falls back to the static `["vercel","gcs","tencent-cos","db"]` list if
 * the `ProviderRegistry` table is unreachable or empty so cold starts and
 * unmigrated environments don't break.
 */
export async function listEnabledStorageProviderKeys(): Promise<string[]> {
  const FALLBACK: StorageProviderName[] = ["vercel", "gcs", "tencent-cos", "db"];
  try {
    const { listProviders } = await import("@/lib/admin/provider-registry");
    const rows = await listProviders("storage", { enabledOnly: true });
    if (rows.length > 0) return rows.map((r) => r.key);
  } catch {
    // fall through to fallback
  }
  return FALLBACK;
}

import type { NextRequest } from "next/server";

import { env } from "@/lib/env";
import { isWeChatOriginatedRequest } from "@/lib/request-origin";
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

  if (
    isWeChatOriginatedRequest(ctx.request ?? null) &&
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

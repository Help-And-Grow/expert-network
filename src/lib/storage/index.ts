import { env } from "@/lib/env";
import { getSystemConfig } from "@/lib/system-config";
import type { StorageProvider, StorageProviderName } from "./types";

/**
 * Factory to get the active storage provider.
 * Async because it reads from SystemConfig database first.
 */
export async function getStorageProvider(): Promise<StorageProvider> {
  const dbProvider = (await getSystemConfig("STORAGE_PROVIDER")) as StorageProviderName | null;
  const providerName = dbProvider || env.STORAGE_PROVIDER || "db";

  switch (providerName) {
    case "vercel":
      const { VercelBlobStorageProvider } = await import("./vercel-blob");
      return new VercelBlobStorageProvider();
    case "gcs":
      const { GoogleCloudStorageProvider } = await import("./gcs");
      return new GoogleCloudStorageProvider();
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

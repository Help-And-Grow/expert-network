import { prisma } from "@/lib/prisma";

const CACHE_TTL = 60 * 1000; // 1 minute
const cache: Record<string, { value: string | null; expires: number }> = {};

/**
 * Fetches a system configuration value from the database with local caching.
 */
export async function getSystemConfig(key: string): Promise<string | null> {
  const now = Date.now();
  if (cache[key] && cache[key].expires > now) {
    return cache[key].value;
  }

  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key },
    });
    const value = config?.value ?? null;
    cache[key] = { value, expires: now + CACHE_TTL };
    return value;
  } catch (e) {
    // Silently fall back to null if DB is not ready or table missing
    console.warn(`[SystemConfig] Failed to fetch key "${key}":`, e);
    return null;
  }
}

/**
 * Updates a system configuration value in the database and clears the local cache.
 */
export async function setSystemConfig(key: string, value: string) {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  delete cache[key];
}

/**
 * Convenience helper to get the active AI provider.
 */
export async function getActiveAIProviderNameFromDB(): Promise<string | null> {
  return getSystemConfig("AI_PROVIDER");
}

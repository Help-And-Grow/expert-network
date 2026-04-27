import { put, del } from "@vercel/blob";
import { env } from "@/lib/env";
import type { StorageProvider } from "./types";

export class VercelBlobStorageProvider implements StorageProvider {
  async upload(
    path: string,
    content: Buffer | string,
    options?: { contentType?: string }
  ): Promise<string> {
    const { url } = await put(path, content, {
      access: "public",
      contentType: options?.contentType,
      token: env.BLOB_READ_WRITE_TOKEN,
    });
    return url;
  }

  async delete(url: string): Promise<void> {
    await del(url, {
      token: env.BLOB_READ_WRITE_TOKEN,
    });
  }

  isConfigured(): boolean {
    return Boolean(env.BLOB_READ_WRITE_TOKEN);
  }
}

import type { StorageProvider } from "./types";

export class DatabaseStorageProvider implements StorageProvider {
  async upload(
    _path: string,
    content: Buffer | string,
    options?: { contentType?: string }
  ): Promise<string> {
    const buffer = Buffer.isBuffer(content) 
      ? content 
      : Buffer.from(content);
    const mime = options?.contentType || "application/octet-stream";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  async delete(_url: string): Promise<void> {
    // No-op for data URLs
  }

  isConfigured(): boolean {
    return true;
  }
}

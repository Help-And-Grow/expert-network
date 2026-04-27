export interface StorageProvider {
  /** Upload a file and return the public URL */
  upload(
    path: string,
    content: Buffer | string,
    options?: { contentType?: string }
  ): Promise<string>;

  /** Delete a file by URL or path */
  delete(url: string): Promise<void>;

  /** Check if the provider is configured */
  isConfigured(): boolean;
}

export type StorageProviderName = "vercel" | "gcs" | "tencent-cos" | "db";

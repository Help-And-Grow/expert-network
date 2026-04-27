import { Storage } from "@google-cloud/storage";
import { env } from "@/lib/env";
import type { StorageProvider } from "./types";

export class GoogleCloudStorageProvider implements StorageProvider {
  private storage: Storage;
  private bucketName: string;

  constructor() {
    this.storage = new Storage({
      projectId: env.GOOGLE_CLOUD_PROJECT,
      // If GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_KEY 
      // are set, the library handles them.
    });
    this.bucketName = env.GCS_BUCKET_NAME || "";
  }

  async upload(
    path: string,
    content: Buffer | string,
    options?: { contentType?: string }
  ): Promise<string> {
    if (!this.bucketName) {
      throw new Error("GCS_BUCKET_NAME is not configured");
    }

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);

    await file.save(content, {
      contentType: options?.contentType,
      resumable: false,
    });

    // Make public if needed, or return the public URL if it's already public
    // Assuming the bucket is configured for public read access or we use uniform bucket-level access.
    // Standard GCS public URL: https://storage.googleapis.com/BUCKET_NAME/FILE_PATH
    return `https://storage.googleapis.com/${this.bucketName}/${path}`;
  }

  async delete(url: string): Promise<void> {
    if (!this.bucketName) return;

    // Extract path from URL if it's a full URL
    let path = url;
    const prefix = `https://storage.googleapis.com/${this.bucketName}/`;
    if (url.startsWith(prefix)) {
      path = url.slice(prefix.length);
    }

    const bucket = this.storage.bucket(this.bucketName);
    await bucket.file(path).delete({ ignoreNotFound: true });
  }

  isConfigured(): boolean {
    return Boolean(env.GCS_BUCKET_NAME && (env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS));
  }
}

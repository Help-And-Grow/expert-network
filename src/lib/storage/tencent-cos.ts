import { env } from "@/lib/env";

import type { StorageProvider } from "./types";

/**
 * Tencent Cloud Object Storage (COS) driver — used for low-latency
 * China-local storage on the WeChat Mini Program path.
 *
 * Public URL shape: https://{bucket}.cos.{region}.myqcloud.com/{path}
 *   e.g. https://hg-wechat-1300000000.cos.ap-guangzhou.myqcloud.com/avatars/abc.jpg
 *
 * The bucket must be configured for public read access for these URLs to
 * resolve unauthenticated. For private buckets, swap the return value with
 * a signed URL (cos.getObjectUrl) — keeping the contract as `Promise<string>`.
 */
type CosClient = {
  putObject: (
    params: Record<string, unknown>,
    cb: (err: Error | null, data: { Location?: string }) => void,
  ) => void;
  deleteObject: (
    params: Record<string, unknown>,
    cb: (err: Error | null) => void,
  ) => void;
};

let _client: CosClient | null = null;

function getClient(): CosClient {
  if (_client) return _client;
  if (!env.TENCENT_COS_SECRET_ID || !env.TENCENT_COS_SECRET_KEY) {
    throw new Error(
      "TENCENT_COS_SECRET_ID and TENCENT_COS_SECRET_KEY must be set to use the Tencent COS driver",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const COS = require("cos-nodejs-sdk-v5") as new (opts: {
    SecretId: string;
    SecretKey: string;
  }) => CosClient;
  _client = new COS({
    SecretId: env.TENCENT_COS_SECRET_ID,
    SecretKey: env.TENCENT_COS_SECRET_KEY,
  });
  return _client;
}

export class TencentCOSStorageProvider implements StorageProvider {
  private bucket: string;
  private region: string;

  constructor() {
    this.bucket = env.TENCENT_COS_BUCKET || "";
    this.region = env.TENCENT_COS_REGION || "";
  }

  async upload(
    path: string,
    content: Buffer | string,
    options?: { contentType?: string },
  ): Promise<string> {
    if (!this.bucket || !this.region) {
      throw new Error("TENCENT_COS_BUCKET and TENCENT_COS_REGION are not configured");
    }

    const cos = getClient();
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const key = path.replace(/^\/+/, "");

    await new Promise<void>((resolve, reject) => {
      cos.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Body: body,
          ContentType: options?.contentType,
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });

    return `https://${this.bucket}.cos.${this.region}.myqcloud.com/${key}`;
  }

  async delete(url: string): Promise<void> {
    if (!this.bucket || !this.region) return;

    const prefix = `https://${this.bucket}.cos.${this.region}.myqcloud.com/`;
    const key = url.startsWith(prefix) ? url.slice(prefix.length) : url.replace(/^\/+/, "");
    if (!key) return;

    const cos = getClient();
    await new Promise<void>((resolve, reject) => {
      cos.deleteObject(
        { Bucket: this.bucket, Region: this.region, Key: key },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  isConfigured(): boolean {
    return Boolean(
      env.TENCENT_COS_SECRET_ID &&
        env.TENCENT_COS_SECRET_KEY &&
        env.TENCENT_COS_BUCKET &&
        env.TENCENT_COS_REGION,
    );
  }
}

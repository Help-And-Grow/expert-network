import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { createAIProviderForName } from "@/lib/ai";
import { getProvider } from "@/lib/admin/provider-registry";
import { resolveEnvironment } from "@/lib/system-config";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Phase 2: live re-probe.
 *
 *   POST /api/admin/providers/test
 *   { category: "llm" | "storage", key: "openai" | "vercel" | ..., environment? }
 *
 * - LLM: instantiate the adapter via `createAIProviderForName` and call
 *   `improveWriting("intro", "ping")` — the cheapest method on the
 *   `AIProvider` interface that exercises the same auth + endpoint as
 *   real traffic. 5s timeout.
 * - Storage: cheapest possible HEAD-style probe per backend (vercel-blob:
 *   `head()` on a non-existent key — 404 is success; gcs: `bucket.exists`;
 *   tencent-cos: `headBucket`; db: a trivial Prisma SELECT 1). 5s timeout.
 *
 * Results cached in-process for 60s keyed by `(category, key, environment)`
 * so repeated clicks don't burn quota.
 */

const PROBE_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60_000;

const bodySchema = z.object({
  category: z.string().min(1),
  key: z.string().min(1),
  environment: z
    .enum(["production", "preview", "development"])
    .optional(),
});

type ProbeResult = {
  ok: boolean;
  latencyMs: number;
  sampleOutput?: string;
  error?: string;
  cached?: boolean;
  probedAt: string; // ISO
};

const probeCache: Map<string, { result: ProbeResult; expires: number }> =
  new Map();

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (isErrorResponse(auth)) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { category, key } = parsed.data;
  const env = resolveEnvironment(parsed.data.environment);
  const cacheKey = `${category}:${key}:${env}`;

  const now = Date.now();
  const cached = probeCache.get(cacheKey);
  if (cached && cached.expires > now) {
    return NextResponse.json({ ...cached.result, cached: true });
  }

  // Validate that the registry knows the row.
  const row = await getProvider(category, key);
  if (!row) {
    const result: ProbeResult = {
      ok: false,
      latencyMs: 0,
      error: `Unknown provider: ${category}/${key}`,
      probedAt: new Date().toISOString(),
    };
    return NextResponse.json(result, { status: 404 });
  }

  let result: ProbeResult;
  if (category === "llm") {
    result = await probeLlm(key);
  } else if (category === "storage") {
    result = await probeStorage(key);
  } else {
    result = {
      ok: false,
      latencyMs: 0,
      error: `Unsupported category for live probe: ${category}`,
      probedAt: new Date().toISOString(),
    };
  }

  probeCache.set(cacheKey, { result, expires: now + CACHE_TTL_MS });
  return NextResponse.json(result);
}

async function probeLlm(key: string): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const provider = createAIProviderForName(key);
    // `improveWriting` is the smallest, lowest-cost method on the AIProvider
    // interface (~10–20 output tokens). It exercises the real auth path and
    // model-routing logic — what we want from a health probe.
    const out = await withTimeout(
      provider.improveWriting("intro", "ping"),
      PROBE_TIMEOUT_MS,
      "LLM probe",
    );
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      sampleOutput: typeof out === "string" ? out.slice(0, 80) : undefined,
      probedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
      probedAt: new Date().toISOString(),
    };
  }
}

async function probeStorage(key: string): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    if (key === "vercel" || key === "vercel-blob") {
      // 404 from `head` on a non-existent key = healthy auth; any other
      // error = misconfigured.
      const { head } = await import("@vercel/blob");
      try {
        await withTimeout(
          head("__healthcheck__/does-not-exist"),
          PROBE_TIMEOUT_MS,
          "Vercel Blob head",
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // "not found" / 404 means auth worked.
        if (/not[\s_-]?found|404|BlobNotFoundError/i.test(msg)) {
          return {
            ok: true,
            latencyMs: Date.now() - startedAt,
            sampleOutput: "vercel-blob auth OK (404 on probe key)",
            probedAt: new Date().toISOString(),
          };
        }
        throw e;
      }
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        probedAt: new Date().toISOString(),
      };
    }
    if (key === "gcs") {
      const { Storage } = await import("@google-cloud/storage");
      const bucketName = process.env.GCS_BUCKET_NAME ?? "";
      if (!bucketName) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: "Missing GCS_BUCKET_NAME",
          probedAt: new Date().toISOString(),
        };
      }
      const storage = new Storage();
      const [exists] = await withTimeout(
        storage.bucket(bucketName).exists(),
        PROBE_TIMEOUT_MS,
        "GCS bucket.exists",
      );
      return {
        ok: !!exists,
        latencyMs: Date.now() - startedAt,
        sampleOutput: exists ? "bucket reachable" : undefined,
        error: exists ? undefined : `GCS bucket "${bucketName}" not found`,
        probedAt: new Date().toISOString(),
      };
    }
    if (key === "tencent-cos") {
      const COS = (await import("cos-nodejs-sdk-v5")).default;
      const cos = new COS({
        SecretId: process.env.TENCENT_COS_SECRET_ID ?? "",
        SecretKey: process.env.TENCENT_COS_SECRET_KEY ?? "",
      });
      const Bucket = process.env.TENCENT_COS_BUCKET ?? "";
      const Region = process.env.TENCENT_COS_REGION ?? "";
      if (!Bucket || !Region) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: "Missing TENCENT_COS_BUCKET or TENCENT_COS_REGION",
          probedAt: new Date().toISOString(),
        };
      }
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          cos.headBucket({ Bucket, Region }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
        PROBE_TIMEOUT_MS,
        "Tencent COS headBucket",
      );
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        sampleOutput: "Tencent COS bucket reachable",
        probedAt: new Date().toISOString(),
      };
    }
    if (key === "db") {
      const { prisma } = await import("@/lib/prisma");
      await withTimeout(
        prisma.$queryRaw`SELECT 1`,
        PROBE_TIMEOUT_MS,
        "DB SELECT 1",
      );
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        sampleOutput: "DB reachable",
        probedAt: new Date().toISOString(),
      };
    }
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: `No probe implemented for storage/${key}`,
      probedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
      probedAt: new Date().toISOString(),
    };
  }
}

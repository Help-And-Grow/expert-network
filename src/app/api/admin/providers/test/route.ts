import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { createAIProviderForName } from "@/lib/ai";
import { getProvider } from "@/lib/admin/provider-registry";
import { resolveEnvironment } from "@/lib/system-config";

export const dynamic = "force-dynamic";
// Function-level cap MUST exceed PROBE_TIMEOUT_MS (currently 20s) plus SDK
// overhead, otherwise Vercel kills the function before our catch block can
// log the structured upstream-error fields — and the operator sees "Vercel
// Runtime Timeout Error: Task timed out" instead of the actual API failure.
export const maxDuration = 30;

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

// Probe timeout. Originally 5s, but Qwen3 / GPT-5 / Gemini-2.5 reasoning
// models routinely emit a 10–25s "thinking" phase before content. A health
// probe shouldn't tell us "broken" just because the provider is slow — so
// we wait up to 20s. The UI keeps the button in a pending state during this
// window, but practical latency stays sub-3s on healthy non-reasoning models.
const PROBE_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 60_000;

const bodySchema = z.union([
  z.object({
    mode: z.literal("provider").optional(),
    category: z.string().min(1),
    key: z.string().min(1),
    environment: z
      .enum(["production", "preview", "development"])
      .optional(),
  }),
  z.object({
    mode: z.literal("scope"),
    category: z.enum(["llm", "image", "voice", "storage"]),
    matchRules: z
      .object({
        isWeChat: z.boolean().optional(),
        region: z.enum(["intl", "cn"]).optional(),
        userAgent: z.string().optional(),
        header: z.record(z.string(), z.string()).optional(),
      })
      .partial(),
    environment: z
      .enum(["production", "preview", "development"])
      .optional(),
  }),
]);

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

/**
 * Rate-limit per (admin user, category, key) to 1 request per second so
 * an over-eager click doesn't burn provider quota. Bucket is keyed by
 * the admin's userId so different admins don't block each other.
 */
const RATE_LIMIT_WINDOW_MS = 1_000;
const lastProbeAt: Map<string, number> = new Map();
function rateLimitKey(
  userId: string,
  category: string,
  key: string,
  env: string,
): string {
  return `${userId}:${category}:${key}:${env}`;
}

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

  const env = resolveEnvironment(parsed.data.environment);

  if ("mode" in parsed.data && parsed.data.mode === "scope") {
    return probeScope(parsed.data.category, parsed.data.matchRules, env);
  }

  const { category, key } = parsed.data;
  const cacheKey = `${category}:${key}:${env}`;

  const now = Date.now();
  const cached = probeCache.get(cacheKey);
  if (cached && cached.expires > now) {
    return NextResponse.json({ ...cached.result, cached: true });
  }

  // 1 req/sec per (admin, category, key, env) to protect provider quotas.
  const rlKey = rateLimitKey(auth.userId, category, key, env);
  const lastAt = lastProbeAt.get(rlKey) ?? 0;
  if (now - lastAt < RATE_LIMIT_WINDOW_MS) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - lastAt);
    return NextResponse.json(
      {
        ok: false,
        latencyMs: 0,
        error: `Rate limited: 1 probe / sec per provider. Retry in ${retryAfterMs}ms.`,
        probedAt: new Date().toISOString(),
      },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(retryAfterMs / 1000).toString() },
      },
    );
  }
  lastProbeAt.set(rlKey, now);

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
    const caps = (row.metadata as unknown as { capabilities?: unknown })?.capabilities;
    const isVoice =
      Array.isArray(caps) &&
      caps.some((c) => typeof c === "string" && c.toLowerCase() === "voice");
    result = isVoice ? await probeVoice(key) : await probeLlm(key);
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

async function probeScope(
  category: "llm" | "image" | "voice" | "storage",
  matchRules: {
    isWeChat?: boolean;
    region?: "intl" | "cn";
    userAgent?: string;
    header?: Record<string, string>;
  },
  environment: string,
) {
  const { resolveChainForRequest } = await import("@/lib/ai/routing");
  const startedAt = Date.now();
  try {
    const chain = await resolveChainForRequest(
      category,
      {
        isWeChat: matchRules.isWeChat ?? false,
        region: matchRules.region,
        userAgent: matchRules.userAgent,
        headers: matchRules.header,
      },
      environment,
      { fallback: () => [] },
    );
    if (chain.length === 0) {
      return NextResponse.json({
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: "No matching scope and empty fallback",
        probedAt: new Date().toISOString(),
      });
    }
    if (category === "llm") {
      const head = await probeLlm(chain[0]);
      return NextResponse.json({
        ...head,
        sampleOutput: `chain=[${chain.join(",")}] ${head.sampleOutput ?? ""}`.trim(),
      });
    }
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - startedAt,
      sampleOutput: `chain=[${chain.join(",")}]`,
      probedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
      probedAt: new Date().toISOString(),
    });
  }
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

async function probeVoice(key: string): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const provider = await (async () => {
      if (key === "qwen-tts") {
        const { QwenTTSProvider } = await import("@/lib/integrations/qwen-tts");
        return new QwenTTSProvider();
      }
      if (key === "gemini-tts") {
        const { GeminiTtsProvider } = await import("@/lib/integrations/gemini-tts");
        return new GeminiTtsProvider();
      }
      throw new Error(`No voice probe implemented for ${key}`);
    })();

    const out = await withTimeout(
      provider.synthesize({ text: "ping" }),
      PROBE_TIMEOUT_MS,
      "Voice probe",
    );

    const byteLen = Buffer.from(out.audioBase64, "base64").length;
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      sampleOutput: `${key} format=${out.format} bytes=${byteLen}`,
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

/**
 * Tencent CloudBase (TCB) HTTP-trigger function — bridges WeChat Mini
 * Program traffic to the GCP-hosted Next.js backend in asia-southeast1.
 *
 * Why this exists:
 *   - WeChat clients can only reach a small set of CN-mainland whitelisted
 *     domains. TCB CDN/HTTP triggers terminate inside that whitelist and
 *     can hop the Great Firewall to GCP cleanly.
 *   - Keeps WeChat-side base URL stable (`https://wechat-proxy.tcb.qcloud.la`)
 *     even when the GCP origin changes (rolling deploys, region failover).
 *
 * Configure with environment variables in TCB:
 *   ORIGIN_BASE_URL  — Cloud Run origin, e.g.
 *                       https://expert-network-xxxx-as.a.run.app
 *   FORWARD_HEADERS  — comma-separated allowlist (default: see below)
 *   PROXY_SHARED_SECRET — optional: clients must send `x-tcb-secret`
 *                          matching this; rejected with 403 otherwise.
 */

const ORIGIN_BASE_URL = process.env.ORIGIN_BASE_URL || "";

const DEFAULT_FORWARD_HEADERS = [
  "content-type",
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "x-telegram-init-data",
  "x-wechat-openid",
  "x-wechat-session-key",
  "x-wechat-signature",
];

const FORWARD_HEADERS = (process.env.FORWARD_HEADERS || DEFAULT_FORWARD_HEADERS.join(","))
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const PROXY_SHARED_SECRET = process.env.PROXY_SHARED_SECRET || "";

function pickHeaders(eventHeaders) {
  const out = {};
  if (!eventHeaders) return out;
  for (const [name, value] of Object.entries(eventHeaders)) {
    const lower = name.toLowerCase();
    if (FORWARD_HEADERS.includes(lower) && value !== undefined && value !== null) {
      out[lower] = value;
    }
  }
  return out;
}

function buildQueryString(eventQueryString) {
  if (!eventQueryString || typeof eventQueryString !== "object") return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(eventQueryString)) {
    if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x)));
    else if (v !== undefined && v !== null) params.append(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function decodeBody(event) {
  if (event.body === undefined || event.body === null) return undefined;
  if (event.isBase64Encoded) return Buffer.from(event.body, "base64");
  return event.body;
}

async function readResponseBody(res) {
  const arr = await res.arrayBuffer();
  const buf = Buffer.from(arr);
  const ct = res.headers.get("content-type") || "";
  const textual =
    ct.startsWith("text/") ||
    ct.includes("json") ||
    ct.includes("xml") ||
    ct.includes("javascript") ||
    ct.includes("yaml");
  if (textual) {
    return { body: buf.toString("utf8"), isBase64Encoded: false };
  }
  return { body: buf.toString("base64"), isBase64Encoded: true };
}

function copyResponseHeaders(srcHeaders) {
  const out = {};
  srcHeaders.forEach((value, name) => {
    const lower = name.toLowerCase();
    // Hop-by-hop or framework-managed headers — let API Gateway own these.
    if (
      lower === "transfer-encoding" ||
      lower === "connection" ||
      lower === "content-encoding" ||
      lower === "content-length"
    ) {
      return;
    }
    out[name] = value;
  });
  return out;
}

exports.main_handler = async (event) => {
  if (!ORIGIN_BASE_URL) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "ORIGIN_BASE_URL is not configured on the TCB function" }),
    };
  }

  if (
    PROXY_SHARED_SECRET &&
    (event.headers?.["x-tcb-secret"] || event.headers?.["X-Tcb-Secret"]) !== PROXY_SHARED_SECRET
  ) {
    return {
      statusCode: 403,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "forbidden" }),
    };
  }

  const method = (event.httpMethod || event.method || "GET").toUpperCase();
  const path = event.path || event.requestContext?.path || "/";
  const qs = buildQueryString(event.queryString || event.queryStringParameters);
  const url = `${ORIGIN_BASE_URL.replace(/\/$/, "")}${path}${qs}`;

  const headers = pickHeaders(event.headers || {});
  // Identify proxied requests at origin so app code can switch behaviour
  // (e.g. choose Tencent COS for uploads). See `request-origin.ts`.
  headers["x-forwarded-via"] = "tcb-proxy";
  headers["x-forwarded-from"] = "wechat";

  const init = {
    method,
    headers,
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = decodeBody(event);
  }

  let upstream;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: "Bad gateway: upstream fetch failed",
        detail: err && err.message ? err.message : String(err),
      }),
    };
  }

  const { body, isBase64Encoded } = await readResponseBody(upstream);
  return {
    statusCode: upstream.status,
    headers: copyResponseHeaders(upstream.headers),
    body,
    isBase64Encoded,
  };
};

/**
 * Stripe integration via direct REST API calls.
 *
 * The official Stripe Node SDK consistently fails with connection errors
 * in Vercel's serverless environment (tested on both Node 20 and 24).
 * Direct fetch to api.stripe.com works reliably, so we use Stripe's
 * well-documented REST API directly.
 *
 * Reference: https://docs.stripe.com/api
 */

const STRIPE_API = "https://api.stripe.com/v1";

function normalizeSecretEnvValue(value: string): string {
  let normalized = value.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  // Some dashboards / copy-paste flows accidentally append the literal characters `\n`.
  normalized = normalized.replace(/(?:\\n|\\r|\\t)+$/g, "").trim();
  return normalized;
}

function getRequiredSecret(name: "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET"): string {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set`);

  const value = normalizeSecretEnvValue(raw);
  if (!value) throw new Error(`${name} is empty`);

  if (/[\\\s]/.test(value)) {
    throw new Error(
      `${name} contains unexpected whitespace or escape characters; re-save it without extra quotes or newlines`
    );
  }

  return value;
}

function getKey(): string {
  return getRequiredSecret("STRIPE_SECRET_KEY");
}

export function getWebhookSecret(): string {
  return getRequiredSecret("STRIPE_WEBHOOK_SECRET");
}

async function stripeRequest<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? encodeBody(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Stripe API error (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

/**
 * Encodes a nested object into Stripe's form-encoded format.
 * e.g. { line_items: [{ price_data: { currency: "sgd" } }] }
 * becomes "line_items[0][price_data][currency]=sgd"
 */
function encodeBody(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          parts.push(encodeBody(item as Record<string, unknown>, `${fullKey}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(encodeBody(value as Record<string, unknown>, fullKey));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.filter(Boolean).join("&");
}

// ---- Connected Accounts (Marketplace) ----

interface StripeAccount {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements?: {
    currently_due: string[];
    eventually_due: string[];
    disabled_reason: string | null;
  };
}

export async function createConnectedAccount(params: {
  email?: string;
  country?: string;
  metadata?: Record<string, string>;
}): Promise<StripeAccount> {
  return stripeRequest<StripeAccount>("POST", "/accounts", {
    type: "express",
    country: params.country || "SG",
    email: params.email || undefined,
    capabilities: {
      transfers: { requested: "true" },
    },
    business_type: "individual",
    metadata: params.metadata,
  });
}

interface AccountLink {
  url: string;
  expires_at: number;
}

export async function createAccountLink(params: {
  account: string;
  refresh_url: string;
  return_url: string;
  type?: string;
}): Promise<AccountLink> {
  return stripeRequest<AccountLink>("POST", "/account_links", {
    account: params.account,
    refresh_url: params.refresh_url,
    return_url: params.return_url,
    type: params.type || "account_onboarding",
  });
}

export async function retrieveAccount(accountId: string): Promise<StripeAccount> {
  return stripeRequest<StripeAccount>("GET", `/accounts/${accountId}`);
}

export function getAccountStatus(account: StripeAccount): "onboarding" | "active" | "restricted" {
  if (!account.details_submitted) return "onboarding";
  if (account.charges_enabled && account.payouts_enabled) return "active";
  return "restricted";
}

// ---- Checkout Sessions ----

interface CheckoutSession {
  id: string;
  url: string | null;
  payment_intent?: string;
  metadata?: Record<string, string>;
}

export async function retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>("GET", `/checkout/sessions/${id}`);
}

export async function createCheckoutSession(params: {
  mode: string;
  payment_method_types?: string[];
  line_items: {
    price_data: {
      currency: string;
      unit_amount: number;
      product_data: { name: string; description?: string };
    };
    quantity: number;
  }[];
  payment_intent_data?: Record<string, unknown>;
  payment_method_options?: Record<string, unknown>;
  metadata?: Record<string, string>;
  success_url: string;
  cancel_url: string;
}): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>("POST", "/checkout/sessions", params);
}

export function getPlatformFeePercent(): number {
  const raw = process.env.STRIPE_PLATFORM_FEE_PERCENT;
  if (raw) {
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 0 && n <= 100) return n;
  }
  return 15;
}

// ---- Payment Intents ----

interface PaymentIntent {
  id: string;
  status: string;
  payment_method?: string;
  customer?: string;
  metadata?: Record<string, string>;
}

export async function retrievePaymentIntent(id: string): Promise<PaymentIntent> {
  return stripeRequest<PaymentIntent>("GET", `/payment_intents/${id}`);
}

export async function createPaymentIntent(params: {
  amount: number;
  currency: string;
  customer: string;
  payment_method: string;
  off_session: boolean;
  confirm: boolean;
  metadata?: Record<string, string>;
}): Promise<PaymentIntent> {
  return stripeRequest<PaymentIntent>("POST", "/payment_intents", params);
}

// ---- Balance (for diagnostics) ----

export async function retrieveBalance(): Promise<Record<string, unknown>> {
  return stripeRequest("GET", "/balance");
}

// ---- Webhook Signature Verification ----

export async function verifyWebhookSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<Record<string, unknown>> {
  const parts = sigHeader.split(",").reduce(
    (acc, part) => {
      const [k, v] = part.split("=");
      if (k === "t") acc.timestamp = v;
      if (k === "v1") acc.signatures.push(v);
      return acc;
    },
    { timestamp: "", signatures: [] as string[] }
  );

  if (!parts.timestamp || parts.signatures.length === 0) {
    throw new Error("Invalid Stripe signature header");
  }

  const signedPayload = `${parts.timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const valid = parts.signatures.some((s) => s === expected);
  if (!valid) throw new Error("Invalid signature");

  const tolerance = 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(parts.timestamp, 10)) > tolerance) {
    throw new Error("Webhook timestamp too old");
  }

  return JSON.parse(payload);
}

// ---- Booking Amount Calculation ----

export function calculateBookingAmount(
  pricePerHourCents: number,
  startTime: Date,
  endTime: Date
): {
  totalCents: number;
  dueNowCents: number;
  depositCents: number;
  remainderCents: number;
} {
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationMinutes = Math.max(30, Math.round(durationMs / (60 * 1000)));
  const totalCents = Math.round(pricePerHourCents * durationMinutes / 60);
  const dueNowCents = totalCents;

  // Legacy callers and DB columns still use "deposit" naming. New bookings
  // require full payment upfront, so the legacy deposit amount equals due-now.
  return {
    totalCents,
    dueNowCents,
    depositCents: dueNowCents,
    remainderCents: 0,
  };
}

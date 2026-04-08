import { env } from "@/lib/env";
import crypto from "crypto";

const MCH_ID = env.WECHAT_PAY_MCH_ID || "";
const API_V3_KEY = env.WECHAT_PAY_API_V3_KEY || "";
const CERT_SERIAL_NO = env.WECHAT_PAY_CERT_SERIAL_NO || "";
const PRIVATE_KEY = env.WECHAT_PAY_PRIVATE_KEY || "";
const APP_ID = env.WECHAT_APP_ID || "";
const NOTIFY_URL =
  env.WECHAT_PAY_NOTIFY_URL ||
  "https://expert-network.vercel.app/api/webhooks/wechat-pay";

const PARTNER_MODE = env.WECHAT_PAY_PARTNER_MODE === "true";
const PLATFORM_MCH_ID = env.WECHAT_PAY_PLATFORM_MCH_ID || MCH_ID;
const PLATFORM_MERCHANT_NAME = env.WECHAT_PAY_PLATFORM_MERCHANT_NAME || "";
const PLATFORM_PUBLIC_KEY_PEM = env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM || "";
const PLATFORM_CERT_SERIAL = env.WECHAT_PAY_PLATFORM_CERT_SERIAL || "";

function getPrivateKey(): string {
  let key = PRIVATE_KEY;
  if (!key.includes("BEGIN")) {
    key = `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`;
  }
  return key;
}

function generateNonceStr(): string {
  return crypto.randomBytes(16).toString("hex");
}

function rsaSha256Sign(message: string): string {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(message);
  sign.end();
  return sign.sign(getPrivateKey(), "base64");
}

function buildAuthorizationHeader(
  method: string,
  url: string,
  body: string
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = generateNonceStr();
  const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = rsaSha256Sign(message);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${MCH_ID}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${CERT_SERIAL_NO}",signature="${signature}"`;
}

export interface UnifiedOrderParams {
  outTradeNo: string;
  description: string;
  totalAmountCNY: number;
  openid: string;
}

export interface PartnerUnifiedOrderParams extends UnifiedOrderParams {
  subMchId: string;
}

export interface UnifiedOrderResult {
  prepayId: string;
}

export async function createUnifiedOrder(
  params: UnifiedOrderParams
): Promise<UnifiedOrderResult> {
  const url = "/v3/pay/transactions/jsapi";
  const body = JSON.stringify({
    appid: APP_ID,
    mchid: MCH_ID,
    description: params.description,
    out_trade_no: params.outTradeNo,
    notify_url: NOTIFY_URL,
    amount: {
      total: params.totalAmountCNY,
      currency: "CNY",
    },
    payer: {
      openid: params.openid,
    },
  });

  const authorization = buildAuthorizationHeader("POST", url, body);

  const res = await fetch(`https://api.mch.weixin.qq.com${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authorization,
    },
    body,
  });

  const data = (await res.json()) as { prepay_id?: string; message?: string };

  if (!res.ok || !data.prepay_id) {
    console.error("[wechat-pay] unified order error:", data);
    throw new Error(data.message || "WeChat Pay order failed");
  }

  return { prepayId: data.prepay_id };
}

/**
 * Service-provider JSAPI prepay: funds settle to sub-merchant; use `settle_info.profit_sharing`
 * so the platform can call `/v3/profitsharing/orders` after payment.
 */
export async function createPartnerUnifiedOrder(
  params: PartnerUnifiedOrderParams
): Promise<UnifiedOrderResult> {
  const url = "/v3/pay/partner/transactions/jsapi";
  const body = JSON.stringify({
    sp_appid: APP_ID,
    sp_mchid: MCH_ID,
    sub_mchid: params.subMchId,
    sub_appid: APP_ID,
    description: params.description,
    out_trade_no: params.outTradeNo,
    notify_url: NOTIFY_URL,
    amount: {
      total: params.totalAmountCNY,
      currency: "CNY",
    },
    payer: {
      sub_openid: params.openid,
    },
    settle_info: {
      profit_sharing: true,
    },
  });

  const authorization = buildAuthorizationHeader("POST", url, body);

  const res = await fetch(`https://api.mch.weixin.qq.com${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authorization,
    },
    body,
  });

  const data = (await res.json()) as { prepay_id?: string; message?: string };

  if (!res.ok || !data.prepay_id) {
    console.error("[wechat-pay] partner unified order error:", data);
    throw new Error(data.message || "WeChat Pay partner order failed");
  }

  return { prepayId: data.prepay_id };
}

export function buildPaymentParams(prepayId: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = generateNonceStr();
  const packageStr = `prepay_id=${prepayId}`;

  const message = `${APP_ID}\n${timestamp}\n${nonceStr}\n${packageStr}\n`;
  const paySign = rsaSha256Sign(message);

  return {
    timeStamp: timestamp,
    nonceStr,
    package: packageStr,
    signType: "RSA" as const,
    paySign,
  };
}

export function decryptResource(
  ciphertext: string,
  nonce: string,
  associatedData: string
): string {
  const key = Buffer.from(API_V3_KEY);
  const ciphertextBuf = Buffer.from(ciphertext, "base64");
  const authTag = ciphertextBuf.subarray(ciphertextBuf.length - 16);
  const encrypted = ciphertextBuf.subarray(0, ciphertextBuf.length - 16);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(nonce)
  );
  decipher.setAuthTag(authTag);
  if (associatedData) {
    decipher.setAAD(Buffer.from(associatedData));
  }

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function verifyWebhookSignature(
  timestamp: string,
  nonce: string,
  body: string,
  signature: string,
  _certPublicKey: string
): boolean {
  try {
    const message = `${timestamp}\n${nonce}\n${body}\n`;
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(message);
    return verify.verify(_certPublicKey, signature, "base64");
  } catch {
    return false;
  }
}

export function isWechatPayConfigured(): boolean {
  return !!(MCH_ID && API_V3_KEY && CERT_SERIAL_NO && PRIVATE_KEY && APP_ID);
}

export function isWechatPayPartnerMode(): boolean {
  return PARTNER_MODE && isWechatPayConfigured();
}

/** OAEP-SHA256 encrypted merchant name for profit-sharing receivers (API v3). */
function encryptForWechatPayPlatform(plain: string): string {
  if (!PLATFORM_PUBLIC_KEY_PEM) {
    throw new Error("WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM is not set");
  }
  const buf = crypto.publicEncrypt(
    {
      key: PLATFORM_PUBLIC_KEY_PEM.includes("BEGIN")
        ? PLATFORM_PUBLIC_KEY_PEM
        : `-----BEGIN PUBLIC KEY-----\n${PLATFORM_PUBLIC_KEY_PEM}\n-----END PUBLIC KEY-----`,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(plain, "utf8")
  );
  return buf.toString("base64");
}

export interface ProfitSharingParams {
  subMchId: string;
  transactionId: string;
  /** Unique per split request; max 64 chars */
  outOrderNo: string;
  /** Amount in CNY fen to send to the platform merchant */
  platformAmountFen: number;
}

/**
 * Request profit sharing after payment (`/v3/profitsharing/orders`).
 * Requires service-provider credentials; sends platform fee to `WECHAT_PAY_PLATFORM_MCH_ID` (defaults to SP mchid).
 * Sensitive `name` field is RSA-OAEP encrypted; set `WECHAT_PAY_PLATFORM_MERCHANT_NAME` and platform cert env vars.
 */
export async function requestProfitSharing(
  params: ProfitSharingParams
): Promise<{ ok: boolean; skippedReason?: string; raw?: unknown }> {
  if (!isWechatPayPartnerMode()) {
    return { ok: false, skippedReason: "not_partner_mode" };
  }
  if (!PLATFORM_MERCHANT_NAME || !PLATFORM_PUBLIC_KEY_PEM || !PLATFORM_CERT_SERIAL) {
    console.warn(
      "[wechat-pay] profit sharing skipped: set WECHAT_PAY_PLATFORM_MERCHANT_NAME, WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM, WECHAT_PAY_PLATFORM_CERT_SERIAL"
    );
    return { ok: false, skippedReason: "missing_platform_encrypt_env" };
  }
  if (params.platformAmountFen <= 0) {
    return { ok: false, skippedReason: "zero_amount" };
  }

  const url = "/v3/profitsharing/orders";
  const nameEnc = encryptForWechatPayPlatform(PLATFORM_MERCHANT_NAME);
  const body = JSON.stringify({
    sub_mchid: params.subMchId,
    transaction_id: params.transactionId,
    out_order_no: params.outOrderNo,
    receivers: [
      {
        type: "MERCHANT_ID",
        account: PLATFORM_MCH_ID,
        name: nameEnc,
        amount: params.platformAmountFen,
        description: "Platform fee",
      },
    ],
    unfreeze_unsplit: true,
  });

  const authorization = buildAuthorizationHeader("POST", url, body);

  const res = await fetch(`https://api.mch.weixin.qq.com${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authorization,
      "Wechatpay-Serial": PLATFORM_CERT_SERIAL,
    },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("[wechat-pay] profitsharing error:", data);
    return { ok: false, skippedReason: "api_error", raw: data };
  }
  return { ok: true, raw: data };
}

const SGD_TO_CNY_RATE = 5.3;

export function convertSGDToCNY(sgdCents: number): number {
  return Math.ceil(sgdCents * SGD_TO_CNY_RATE);
}

/** Platform fee portion of a CNY amount (fen), same basis points as Stripe's `getPlatformFeePercent`. */
export function wechatPlatformFeePercent(): number {
  const raw = process.env.STRIPE_PLATFORM_FEE_PERCENT;
  if (raw) {
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 0 && n <= 100) return n;
  }
  return 15;
}

/**
 * Deposit amount in CNY fen allocated to the platform (rounded down), for profit-sharing request.
 */
export function computeWechatPlatformShareFen(
  depositCnyFen: number,
  feePercent: number
): number {
  if (depositCnyFen <= 0 || feePercent <= 0) return 0;
  return Math.floor((depositCnyFen * feePercent) / 100);
}

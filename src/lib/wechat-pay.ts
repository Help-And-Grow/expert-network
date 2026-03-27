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

  const data = await res.json();

  if (!res.ok || !data.prepay_id) {
    console.error("[wechat-pay] unified order error:", data);
    throw new Error(data.message || "WeChat Pay order failed");
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
  // In production, verify using WeChat Pay's platform certificate.
  // For now, rely on AEAD decryption as the primary verification.
  // Full signature verification requires fetching platform certs from
  // /v3/certificates and caching them.
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

const SGD_TO_CNY_RATE = 5.3;

export function convertSGDToCNY(sgdCents: number): number {
  return Math.ceil((sgdCents * SGD_TO_CNY_RATE) / 100);
}

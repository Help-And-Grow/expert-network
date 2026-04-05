import QRCode from "qrcode";

type PayNowPayloadInput = {
  uen: string;
  companyName: string;
  amountCents: number;
  reference: string;
  editableAmount?: boolean;
  expiryDate?: string;
};

export type PayNowConfig = {
  uen: string;
  companyName: string;
  editableAmount: boolean;
};

function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function cleanText(input: string, maxLen: number): string {
  return input
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, maxLen);
}

export function getPayNowConfig(): PayNowConfig | null {
  const uen = process.env.PAYNOW_UEN?.trim();
  if (!uen) return null;

  const companyName = cleanText(
    process.env.PAYNOW_COMPANY_NAME || "Help & Grow",
    25
  );
  const editableAmount =
    (process.env.PAYNOW_EDITABLE_AMOUNT || "false").toLowerCase() === "true";

  return { uen, companyName, editableAmount };
}

export function supportsPayNowForCurrency(currency?: string | null): boolean {
  return (currency || "SGD").toUpperCase() === "SGD" && !!getPayNowConfig();
}

export function buildPayNowPayload(input: PayNowPayloadInput): string {
  if (!input.uen) {
    throw new Error("PayNow UEN is required");
  }
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  const amount = (input.amountCents / 100).toFixed(2);
  const company = cleanText(input.companyName, 25);
  const reference = cleanText(input.reference, 25);

  const merchantAccountInfo =
    tlv("00", "SG.PAYNOW") +
    tlv("01", "2") + // 2 = UEN
    tlv("02", input.uen) +
    tlv("03", input.editableAmount ? "1" : "0") +
    (input.expiryDate ? tlv("04", input.expiryDate) : "");

  const additionalData = tlv("01", reference);

  const withoutCrc =
    tlv("00", "01") +
    tlv("01", "12") + // dynamic QR
    tlv("26", merchantAccountInfo) +
    tlv("52", "0000") +
    tlv("53", "702") + // SGD
    tlv("54", amount) +
    tlv("58", "SG") +
    tlv("59", company || "Help & Grow") +
    tlv("60", "Singapore") +
    tlv("62", additionalData) +
    "6304";

  return `${withoutCrc}${crc16Ccitt(withoutCrc)}`;
}

export async function buildPayNowQrDataUrl(
  input: PayNowPayloadInput
): Promise<{ payload: string; qrDataUrl: string }> {
  const payload = buildPayNowPayload(input);
  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
  return { payload, qrDataUrl };
}

import * as fs from "fs";

import { importPKCS8, SignJWT } from "jose";

import { env } from "@/lib/env";

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cachedToken:
  | {
      token: string;
      expiresAt: number;
    }
  | null = null;

function readServiceAccountKey(): ServiceAccountKey | null {
  const encoded = env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (encoded) {
    try {
      return JSON.parse(encoded) as ServiceAccountKey;
    } catch {
      return JSON.parse(
        Buffer.from(encoded, "base64").toString("utf-8"),
      ) as ServiceAccountKey;
    }
  }

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) return null;

  return JSON.parse(fs.readFileSync(keyPath, "utf-8")) as ServiceAccountKey;
}

export function hasGoogleServiceAccountConfig(): boolean {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export async function getGoogleAccessToken(
  scopes: string[] = ["https://www.googleapis.com/auth/cloud-platform"],
): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const key = readServiceAccountKey();
  if (!key?.client_email || !key.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS is required for Vertex AI access",
    );
  }

  const tokenUri = key.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);

  const signer = await importPKCS8(key.private_key, "RS256");
  const assertion = await new SignJWT({ scope: scopes.join(" ") })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(key.client_email)
    .setSubject(key.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(signer);

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google OAuth token exchange failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error("Google OAuth token exchange succeeded without an access token");
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return data.access_token;
}

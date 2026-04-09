import * as fs from "fs";

import { GoogleGenAI } from "@google/genai";

import { env } from "@/lib/env";

const DEFAULT_GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

export function getGeminiTextModel(): string {
  return env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_GEMINI_TEXT_MODEL;
}

export function getGeminiImageModel(): string {
  return env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
}

function setupServiceAccountAuth() {
  const encoded = env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded || process.env.GOOGLE_APPLICATION_CREDENTIALS) return;

  const keyPath = "/tmp/gcp-sa-key.json";
  let json = encoded;
  try {
    JSON.parse(encoded);
  } catch {
    json = Buffer.from(encoded, "base64").toString("utf-8");
  }
  fs.writeFileSync(keyPath, json);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
}

export function createGeminiClient(): GoogleGenAI {
  const project = env.GOOGLE_CLOUD_PROJECT;
  const location = env.GOOGLE_CLOUD_LOCATION || "us-central1";

  if (project) {
    setupServiceAccountAuth();
    console.log(
      `[Gemini] Using Vertex AI (project=${project}, location=${location})`,
    );
    return new GoogleGenAI({ vertexai: true, project, location });
  }

  console.log("[Gemini] Using AI Studio API key");
  return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "" });
}

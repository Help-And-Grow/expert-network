import * as fs from "fs";

import { GoogleGenAI } from "@google/genai";

import { env } from "@/lib/env";

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
  const project = env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = env.GOOGLE_CLOUD_LOCATION?.trim() || "us-central1";

  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT is required for Gemini via Vertex AI.",
    );
  }

  setupServiceAccountAuth();
  console.log(
    `[Gemini] Using Vertex AI (project=${project}, location=${location})`,
  );
  return new GoogleGenAI({ vertexai: true, project, location });
}

/**
 * Vertex `gemini-3.1-flash-image-preview` is only available in certain regions (e.g. global, us-central1).
 * Text/chat may use `GOOGLE_CLOUD_LOCATION=asia-southeast1` while image must call a supported endpoint.
 */
export function createGeminiImageClient(): GoogleGenAI {
  const project = env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT is required for Gemini image generation via Vertex AI.",
    );
  }

  setupServiceAccountAuth();
  let location = (
    env.GEMINI_IMAGE_VERTEX_LOCATION?.trim() ||
    env.GOOGLE_CLOUD_LOCATION?.trim() ||
    "global"
  ).toLowerCase();
  if (!isVertexImageModelRegion(location)) {
    console.warn(
      `[Gemini] "${location}" is not a known gemini-3.1-flash-image-preview Vertex region; using "global" for image. Set GEMINI_IMAGE_VERTEX_LOCATION (e.g. global or us-central1).`,
    );
    location = "global";
  }
  console.log(
    `[Gemini] Image generation Vertex (project=${project}, location=${location})`,
  );
  return new GoogleGenAI({ vertexai: true, project, location });
}

/** Regions listed for Gemini 3.1 Flash Image Preview on Vertex AI (see Google Cloud model card). */
const VERTEX_GEMINI_IMAGE_REGIONS = new Set([
  "global",
  "us-central1",
  "us-east1",
  "us-east4",
  "us-east5",
  "us-south1",
  "us-west1",
  "us-west4",
  "europe-central2",
  "europe-north1",
  "europe-southwest1",
  "europe-west1",
  "europe-west4",
  "europe-west8",
]);

function isVertexImageModelRegion(loc: string): boolean {
  return VERTEX_GEMINI_IMAGE_REGIONS.has(loc.toLowerCase());
}

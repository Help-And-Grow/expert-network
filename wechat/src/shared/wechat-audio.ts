import Taro from "@tarojs/taro";

import { getApiBase, getToken } from "./auth";

/**
 * Mini Program: InnerAudioContext does not reliably play `data:audio/...;base64,...` URLs.
 * Write to USER_DATA_PATH and return a local file path for createInnerAudioContext.
 */
const DATA_AUDIO_RE = /^data:audio\/([^;]+);base64,([\s\S]+)$/i;

function extFromMime(mimePart: string): string {
  const m = mimePart.toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4") || m.includes("aac") || m.includes("m4a")) return "m4a";
  return "bin";
}

function isSuccessfulDownloadStatus(statusCode: number): boolean {
  return statusCode === 200 || statusCode === 206;
}

function mimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/m4a";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "audio/mpeg";
}

export async function prepareAudioForInnerAudio(
  src: string,
  cacheKey: string,
): Promise<string> {
  const trimmed = src.trim();

  if (trimmed.startsWith("data:")) {
    const match = trimmed.match(DATA_AUDIO_RE);
    if (!match) {
      throw new Error("Unsupported data: URL (expected data:audio/*;base64,...)");
    }
    const ext = extFromMime(match[1]);
    const b64 = match[2].replace(/\s/g, "");
    const fs = Taro.getFileSystemManager();
    const root = Taro.env.USER_DATA_PATH;
    if (!root) {
      throw new Error("Taro.env.USER_DATA_PATH is empty (WeChat base lib too old?)");
    }
    const safeKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    const filePath = `${root}/hg_vc_${safeKey}.${ext}`;

    await new Promise<void>((resolve, reject) => {
      fs.writeFile({
        filePath,
        data: b64,
        encoding: "base64",
        success: () => resolve(),
        fail: (err) => reject(err),
      });
    });

    return filePath;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const res = await Taro.downloadFile({ url: trimmed });
    if (!isSuccessfulDownloadStatus(res.statusCode) || !res.tempFilePath) {
      throw new Error(`downloadFile failed: ${res.statusCode}`);
    }
    return res.tempFilePath;
  }

  const API_BASE = getApiBase();
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const join = path.includes("?") ? "&" : "?";
  const url = `${API_BASE}${path}${join}full=1`;
  const token = getToken();
  const res = await Taro.downloadFile({
    url,
    header: token ? { "x-wechat-token": token } : {},
  });
  // Our audio API may return 206 Partial Content when WeChat sends Range (same as browser probes).
  if (!isSuccessfulDownloadStatus(res.statusCode) || !res.tempFilePath) {
    throw new Error(`downloadFile failed: ${res.statusCode}`);
  }
  return res.tempFilePath;
}

export async function readLocalAudioAsBase64(
  filePath: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  const fs = Taro.getFileSystemManager();
  const audioBase64 = await new Promise<string>((resolve, reject) => {
    fs.readFile({
      filePath,
      encoding: "base64",
      success: (res) => {
        const data = res.data;
        if (typeof data === "string" && data.length > 0) {
          resolve(data);
          return;
        }
        reject(new Error("Audio file is empty"));
      },
      fail: (err) => reject(err),
    });
  });

  return {
    audioBase64,
    mimeType: mimeFromPath(filePath),
  };
}

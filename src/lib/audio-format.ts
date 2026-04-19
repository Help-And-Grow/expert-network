type NormalizeAudioOptions = {
  buffer: Buffer | Uint8Array;
  declaredMime?: string | null;
  declaredFormat?: string | null;
  fallbackPcmSampleRateHz?: number;
};

function parseMimeParts(value?: string | null): {
  raw: string;
  baseMime: string;
  params: Map<string, string>;
} {
  const raw = value?.trim().toLowerCase() ?? "";
  if (!raw) {
    return { raw: "", baseMime: "", params: new Map() };
  }

  const parts = raw.split(";").map((part) => part.trim()).filter(Boolean);
  const [baseMime = "", ...paramParts] = parts;
  const params = new Map<string, string>();
  for (const part of paramParts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (key) params.set(key, val);
  }
  return { raw, baseMime, params };
}

export function normalizeFetchedAudioMime(contentType: string | null): string | null {
  const { baseMime, params } = parseMimeParts(contentType);
  if (!baseMime || !baseMime.startsWith("audio/")) return null;
  const normalizedBase =
    baseMime === "audio/mp3"
      ? "audio/mpeg"
      : baseMime === "audio/x-wav" || baseMime === "audio/wave"
        ? "audio/wav"
        : baseMime;
  const rate = params.get("rate");
  return rate ? `${normalizedBase};rate=${rate}` : normalizedBase;
}

export function detectAudioMime(data: Buffer | Uint8Array): string | null {
  if (data.length < 4) return null;

  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x41 &&
    data[10] === 0x56 &&
    data[11] === 0x45
  ) {
    return "audio/wav";
  }

  if (
    (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) ||
    (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }

  if (
    data.length >= 4 &&
    data[0] === 0x4f &&
    data[1] === 0x67 &&
    data[2] === 0x67 &&
    data[3] === 0x53
  ) {
    return "audio/ogg";
  }

  if (
    data.length >= 4 &&
    data[0] === 0x1a &&
    data[1] === 0x45 &&
    data[2] === 0xdf &&
    data[3] === 0xa3
  ) {
    return "audio/webm";
  }

  if (
    data.length >= 8 &&
    data[4] === 0x66 &&
    data[5] === 0x74 &&
    data[6] === 0x79 &&
    data[7] === 0x70
  ) {
    return "audio/mp4";
  }

  if (data[0] === 0xff && (data[1] & 0xf6) === 0xf0) {
    return "audio/aac";
  }

  if (
    data.length >= 4 &&
    data[0] === 0x66 &&
    data[1] === 0x4c &&
    data[2] === 0x61 &&
    data[3] === 0x43
  ) {
    return "audio/flac";
  }

  if (
    data.length >= 12 &&
    data[0] === 0x46 &&
    data[1] === 0x4f &&
    data[2] === 0x52 &&
    data[3] === 0x4d &&
    data[8] === 0x41 &&
    data[9] === 0x49 &&
    data[10] === 0x46 &&
    (data[11] === 0x46 || data[11] === 0x43)
  ) {
    return "audio/aiff";
  }

  return null;
}

export function formatFromAudioMime(mimeType: string | null): string {
  const { baseMime } = parseMimeParts(mimeType);
  if (baseMime === "audio/mpeg") return "mp3";
  if (baseMime === "audio/ogg") return "ogg";
  if (baseMime === "audio/mp4") return "mp4";
  if (baseMime === "audio/webm") return "webm";
  if (baseMime === "audio/aac") return "aac";
  if (baseMime === "audio/flac") return "flac";
  if (baseMime === "audio/aiff") return "aiff";
  return "wav";
}

export function mimeFromDeclaredFormat(format?: string | null): string {
  const normalized = format?.trim().toLowerCase();
  if (normalized === "mp3" || normalized === "mpeg") return "audio/mpeg";
  if (normalized === "ogg" || normalized === "opus") return "audio/ogg";
  if (normalized === "mp4" || normalized === "m4a") return "audio/mp4";
  if (normalized === "webm") return "audio/webm";
  if (normalized === "aac") return "audio/aac";
  if (normalized === "flac") return "audio/flac";
  if (normalized === "aiff" || normalized === "aif") return "audio/aiff";
  return "audio/wav";
}

function parseAudioSampleRate(contentType: string | null): number | null {
  const { params } = parseMimeParts(contentType);
  const rawRate = params.get("rate") ?? params.get("samplerate");
  if (!rawRate) return null;
  const sampleRate = Number.parseInt(rawRate, 10);
  return Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : null;
}

function shouldWrapAsPcmWav(mimeType: string | null, format?: string | null): boolean {
  const { baseMime } = parseMimeParts(mimeType);
  if (
    baseMime === "audio/l16" ||
    baseMime === "audio/pcm" ||
    baseMime === "audio/raw" ||
    baseMime === "audio/wav"
  ) {
    return true;
  }

  const normalizedFormat = format?.trim().toLowerCase();
  return normalizedFormat === "wav";
}

export function wrapPcm16LeAsWav(
  data: Buffer | Uint8Array,
  sampleRateHz: number,
  channelCount = 1,
): Buffer {
  const pcm = Buffer.from(data);
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRateHz * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export function normalizeAudioForBrowserPlayback({
  buffer,
  declaredMime,
  declaredFormat,
  fallbackPcmSampleRateHz = 24_000,
}: NormalizeAudioOptions): { buffer: Buffer; mimeType: string } {
  const audioBuffer = Buffer.from(buffer);
  const detectedMime = detectAudioMime(audioBuffer);
  if (detectedMime) {
    return { buffer: audioBuffer, mimeType: detectedMime };
  }

  const normalizedDeclaredMime =
    normalizeFetchedAudioMime(declaredMime ?? null) ||
    mimeFromDeclaredFormat(declaredFormat);

  if (shouldWrapAsPcmWav(normalizedDeclaredMime, declaredFormat)) {
    const sampleRateHz =
      parseAudioSampleRate(normalizedDeclaredMime) ?? fallbackPcmSampleRateHz;
    return {
      buffer: wrapPcm16LeAsWav(audioBuffer, sampleRateHz),
      mimeType: "audio/wav",
    };
  }

  return {
    buffer: audioBuffer,
    mimeType: normalizedDeclaredMime,
  };
}

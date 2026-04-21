type PreparedAudioSource = {
  src: string;
  revoke: () => void;
};

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Telegram's in-app WebView is stricter than desktop browsers about large
 * `data:audio/...` strings assigned to media elements. Convert them to short
 * blob URLs before playback.
 */
export function prepareAudioSourceForElement(rawSrc: string): PreparedAudioSource | null {
  const src = rawSrc.trim();
  if (!src) return null;

  if (
    typeof window === "undefined" ||
    !src.toLowerCase().startsWith("data:audio/")
  ) {
    return { src, revoke: () => {} };
  }

  if (
    typeof window.atob !== "function" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return { src, revoke: () => {} };
  }

  const commaIndex = src.indexOf(",");
  if (commaIndex <= 5) return null;

  const metadata = src.slice(5, commaIndex).trim();
  const payload = src.slice(commaIndex + 1).replace(/\s+/g, "");
  const metadataParts = metadata.split(";").map((part) => part.trim()).filter(Boolean);
  const mimeType = metadataParts[0]?.toLowerCase();

  if (!mimeType?.startsWith("audio/") || !metadataParts.some((part) => part.toLowerCase() === "base64")) {
    return null;
  }

  try {
    const bytes = decodeBase64ToBytes(payload);
    const audioBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([audioBuffer], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    return {
      src: objectUrl,
      revoke: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    console.warn("[client-audio-source] Failed to prepare audio source", error);
    return null;
  }
}

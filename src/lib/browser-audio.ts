function getAudioContextCtor():
  | (new (contextOptions?: AudioContextOptions) => AudioContext)
  | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as typeof window & {
      webkitAudioContext?: new (
        contextOptions?: AudioContextOptions,
      ) => AudioContext;
    }).webkitAudioContext ||
    null
  );
}

const GEMINI_READY_AUDIO_TYPES = new Set([
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);

export function getPreferredGeminiRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const mimeType of [
    "audio/ogg;codecs=opus",
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
  ]) {
    try {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    } catch {
      // Some in-app WebViews throw a SyntaxError for MIME strings they do not parse.
    }
  }
  return "";
}

export function createAudioMediaRecorder(
  stream: MediaStream,
  preferredMimeType: string,
): MediaRecorder {
  if (preferredMimeType) {
    try {
      return new MediaRecorder(stream, { mimeType: preferredMimeType });
    } catch {
      // Fall back to the WebView's default container/codec.
    }
  }

  return new MediaRecorder(stream);
}

export function getRecorderMimeType(recorder: MediaRecorder, fallbackMimeType: string): string {
  try {
    if (recorder.mimeType) {
      return recorder.mimeType;
    }
  } catch {
    // Some WebViews expose mimeType but throw when read.
  }
  return fallbackMimeType || "audio/webm";
}

export function formatRecordingStartError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "Microphone access denied";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found";
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("expected pattern")) {
    return "This Telegram WebView could not start voice recording with its audio format. Please try again or use text chat.";
  }

  return message || "Could not start voice recording";
}

function isGeminiReadyAudioType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() || "";
  return GEMINI_READY_AUDIO_TYPES.has(normalized);
}

function audioBufferToMonoWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const channels = audioBuffer.numberOfChannels;
  const frameCount = audioBuffer.length;
  const pcm = new Int16Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sample = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sample += audioBuffer.getChannelData(channel)[frame] || 0;
    }
    sample /= Math.max(channels, 1);
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm[frame] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeAscii(offset: number, value: string) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of pcm) {
    view.setInt16(offset, sample, true);
    offset += bytesPerSample;
  }

  return buffer;
}

export async function normalizeRecordedAudioForGemini(blob: Blob): Promise<Blob> {
  if (isGeminiReadyAudioType(blob.type)) {
    return blob;
  }

  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error("This browser cannot prepare audio for Gemini voice chat.");
  }

  const context = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    const wav = audioBufferToMonoWav(decoded);
    return new Blob([wav], { type: "audio/wav" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("expected pattern")) {
      throw new Error(
        "Could not prepare recorded audio in this Telegram WebView. Please try recording again or use text chat.",
      );
    }
    throw new Error(`Could not prepare recorded audio for Gemini: ${message}`);
  } finally {
    void context.close().catch(() => {});
  }
}

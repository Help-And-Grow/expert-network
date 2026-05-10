/**
 * Shared AudioContext resume in direct response to a user gesture (click/tap).
 * Helps HTMLAudioElement.play() succeed after async work (e.g. fetch → TTS).
 */
let sharedCtx: AudioContext | null = null;
let didUnlockAudioElement = false;

export function resumeSharedAudioContext(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!sharedCtx) {
      sharedCtx = new Ctor();
    }
    void sharedCtx.resume();
  } catch {
    /* ignore */
  }

  if (!didUnlockAudioElement) {
    didUnlockAudioElement = true;
    try {
      const audio = document.createElement("audio");
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");
      audio.muted = true;
      audio.volume = 0;
      audio.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
      void audio.play().then(() => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        audio.remove();
      }).catch(() => {});
    } catch {
    }
  }
}

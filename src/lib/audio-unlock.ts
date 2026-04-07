/**
 * Shared AudioContext resume in direct response to a user gesture (click/tap).
 * Helps HTMLAudioElement.play() succeed after async work (e.g. fetch → TTS).
 */
let sharedCtx: AudioContext | null = null;

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
}

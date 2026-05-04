/**
 * Provider interfaces for all external integrations.
 *
 * Each integration follows the provider pattern:
 *   1. Define an interface here
 *   2. Implement it in a dedicated file (e.g. qwen-tts.ts)
 *   3. Register the provider in config.ts
 *   4. Consumers access providers via getProvider<T>(name)
 */

// ---------------------------------------------------------------------------
// Voice Synthesis (Text-to-Speech)
// ---------------------------------------------------------------------------

export interface VoiceSynthesisProvider {
  /** Generate speech audio from text. Returns base64-encoded audio. */
  synthesize(input: VoiceSynthesisInput): Promise<VoiceSynthesisResult>;
  /** Resolve the default voice model ID for a given gender. */
  getDefaultVoiceId?(gender?: string | null): string | undefined;
  /** Clone a voice from an audio sample. Returns the new voice model ID. */
  cloneVoice?(title: string, audio: Buffer | Uint8Array, transcript?: string): Promise<string>;
  /** List available voice models. */
  listVoices?(): Promise<VoiceModel[]>;
}

export interface VoiceSynthesisInput {
  text: string;
  voiceId?: string;
  /** Speaking speed multiplier (0.5–2.0, default 1.0) */
  speed?: number;
  format?: "mp3" | "wav" | "opus";
}

export interface VoiceSynthesisResult {
  audioBase64: string;
  format: string;
  durationMs?: number;
}

export interface VoiceModel {
  id: string;
  name: string;
  language?: string;
  preview?: string;
}

// ---------------------------------------------------------------------------
// Persistent Memory (per-agent cloud memory)
// ---------------------------------------------------------------------------

export interface MemoryProvider {
  /** Provision a new memory space; returns the space ID. */
  createSpace(): Promise<string>;
  /** Store a memory entry. */
  store(spaceId: string, entry: MemoryEntry): Promise<string>;
  /** Hybrid search across memories. */
  search(spaceId: string, query: string, limit?: number): Promise<MemoryEntry[]>;
  /** Retrieve a memory by ID. */
  get(spaceId: string, memoryId: string): Promise<MemoryEntry | null>;
  /** Update an existing memory. */
  update(spaceId: string, memoryId: string, content: string): Promise<void>;
  /** Delete a memory. */
  delete(spaceId: string, memoryId: string): Promise<void>;
  /** Import a file (session transcript, notes, etc.). */
  importFile(spaceId: string, file: Buffer | Uint8Array, meta: ImportMeta): Promise<string>;
}

export interface MemoryEntry {
  id?: string;
  content: string;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  memoryType?: "insight" | "pinned" | "session" | string;
  state?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImportMeta {
  fileType: "memory" | "session";
  agentId?: string;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Voice Input (Speech-to-Text / Dictation)
// ---------------------------------------------------------------------------

export interface VoiceInputProvider {
  /** Check if the provider is available in the current environment. */
  isAvailable(): boolean;
  /** Start listening; returns a stream of partial/final transcripts. */
  startListening(options?: VoiceInputOptions): void;
  /** Stop listening. */
  stopListening(): void;
  /** Register transcript callback. */
  onTranscript(cb: (text: string, isFinal: boolean) => void): void;
  /** Register error callback. */
  onError(cb: (error: Error) => void): void;
}

export interface VoiceInputOptions {
  language?: string;
  continuous?: boolean;
}

// ---------------------------------------------------------------------------
// Meeting Recording / Transcription
// ---------------------------------------------------------------------------

export interface MeetingRecordingProvider {
  /** Start a recording session. Returns a session ID. */
  startSession(expertId: string, meta?: Record<string, string>): Promise<string>;
  /** Stop the recording and return the transcript. */
  stopSession(sessionId: string): Promise<MeetingTranscript>;
  /** Upload an existing recording for transcription. */
  transcribeFile(file: Buffer, format: string): Promise<MeetingTranscript>;
}

export interface MeetingTranscript {
  sessionId: string;
  text: string;
  segments?: TranscriptSegment[];
  durationMs?: number;
}

export interface TranscriptSegment {
  speaker?: string;
  text: string;
  startMs: number;
  endMs: number;
}

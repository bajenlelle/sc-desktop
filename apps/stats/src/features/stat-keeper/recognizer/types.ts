/**
 * The recogniser boundary: the live screen only sees utterances with a start
 * time, so the OS recogniser, Picovoice Rhino or a cloud stream can be
 * swapped without touching the grammar or the reducer.
 */
export interface RecognizedUtterance {
  transcript: string;
  isFinal: boolean;
  /** Epoch ms when the keeper started speaking this utterance — the event's recordedAt. */
  startedAt: number;
  confidence: number | null;
}

export type RecognizerStatus = "idle" | "listening" | "restarting" | "stopped" | "error";

export interface RecognizerAvailability {
  ok: boolean;
  onDevice: boolean;
  reason?: string;
}

export interface RecognizerStartOptions {
  locale: string;
  contextualStrings: string[];
  persistAudio: boolean;
}

export interface Recognizer {
  readonly kind: "expo-speech" | "mock";
  checkAvailability(locale: string): Promise<RecognizerAvailability>;
  requestPermissions(): Promise<boolean>;
  start(opts: RecognizerStartOptions): Promise<void>;
  stop(): Promise<{ audioUris: string[] }>;
  onUtterance(cb: (u: RecognizedUtterance) => void): () => void;
  onStatus(cb: (status: RecognizerStatus, detail?: string) => void): () => void;
  /** 0–1 input level for the meter, when the engine reports it. */
  onLevel(cb: (level: number) => void): () => void;
}

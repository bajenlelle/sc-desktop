/**
 * A recogniser you can drive by hand (simulator, tests, demos): call
 * `say("tvåa nio")` and the live screen reacts exactly as it would to speech.
 */
import type { Recognizer, RecognizedUtterance, RecognizerStatus } from "./types";

export class MockRecognizer implements Recognizer {
  readonly kind = "mock" as const;
  private utteranceCbs = new Set<(u: RecognizedUtterance) => void>();
  private statusCbs = new Set<(s: RecognizerStatus, detail?: string) => void>();
  private levelCbs = new Set<(l: number) => void>();
  private listening = false;

  async checkAvailability() {
    return { ok: true, onDevice: true };
  }
  async requestPermissions() {
    return true;
  }
  async start() {
    this.listening = true;
    for (const cb of this.statusCbs) cb("listening");
  }
  async stop() {
    this.listening = false;
    for (const cb of this.statusCbs) cb("stopped");
    return { audioUris: [] };
  }
  onUtterance(cb: (u: RecognizedUtterance) => void) {
    this.utteranceCbs.add(cb);
    return () => this.utteranceCbs.delete(cb);
  }
  onStatus(cb: (s: RecognizerStatus, detail?: string) => void) {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }
  onLevel(cb: (l: number) => void) {
    this.levelCbs.add(cb);
    return () => this.levelCbs.delete(cb);
  }
  /** Simulate a spoken, final utterance that started `latencyMs` ago. */
  say(transcript: string, latencyMs = 1200) {
    if (!this.listening) return;
    const u: RecognizedUtterance = { transcript, isFinal: true, startedAt: Date.now() - latencyMs, confidence: 0.9 };
    for (const cb of this.utteranceCbs) cb(u);
  }
}

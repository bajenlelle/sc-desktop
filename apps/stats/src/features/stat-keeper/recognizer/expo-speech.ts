/**
 * On-device recognition through expo-speech-recognition (Apple Speech on
 * iOS, Android SpeechRecognizer). Continuous mode, biased towards the
 * roster and the command vocabulary, restarted by a watchdog whenever the
 * engine ends a session on its own (iOS does after a final result or ~1 min).
 *
 * Utterance start = the `speechstart` event when the engine emits one, else
 * the first interim result of a new utterance. That is what the reducer
 * stores as recordedAt; the export subtracts the configured lead.
 */
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import type {
  Recognizer,
  RecognizedUtterance,
  RecognizerAvailability,
  RecognizerStartOptions,
  RecognizerStatus,
} from "./types";

type Sub = { remove: () => void };

const BACKOFF_MS = [250, 500, 1000, 2000];

export class ExpoSpeechRecognizer implements Recognizer {
  readonly kind = "expo-speech" as const;
  private utteranceCbs = new Set<(u: RecognizedUtterance) => void>();
  private statusCbs = new Set<(s: RecognizerStatus, detail?: string) => void>();
  private levelCbs = new Set<(l: number) => void>();
  private subs: Sub[] = [];
  private wanted = false;
  private opts: RecognizerStartOptions | null = null;
  private utteranceStart: number | null = null;
  private restarts = 0;
  private audioUris: string[] = [];
  private onDevice = false;

  async checkAvailability(locale: string): Promise<RecognizerAvailability> {
    try {
      const onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      const locales = await ExpoSpeechRecognitionModule.getSupportedLocales({});
      const installed = (locales.installedLocales ?? []).map((l: string) => l.toLowerCase());
      const supported = (locales.locales ?? []).map((l: string) => l.toLowerCase());
      const want = locale.toLowerCase();
      const wantShort = want.split("-")[0];
      const has = (list: string[]) => list.some((l) => l === want || l.startsWith(wantShort));
      if (onDevice && has(installed)) return { ok: true, onDevice: true };
      if (has(supported)) return { ok: true, onDevice: false, reason: "Swedish is recognised over the network on this phone." };
      return { ok: false, onDevice: false, reason: "Swedish speech recognition is not available on this phone." };
    } catch (e) {
      return { ok: false, onDevice: false, reason: e instanceof Error ? e.message : "Speech recognition unavailable" };
    }
  }

  async requestPermissions(): Promise<boolean> {
    const r = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return r.granted;
  }

  async start(opts: RecognizerStartOptions): Promise<void> {
    this.opts = opts;
    this.wanted = true;
    this.restarts = 0;
    this.audioUris = [];
    const availability = await this.checkAvailability(opts.locale);
    this.onDevice = availability.onDevice;
    this.attach();
    this.launch();
  }

  async stop(): Promise<{ audioUris: string[] }> {
    this.wanted = false;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped.
    }
    this.detach();
    this.emitStatus("stopped");
    return { audioUris: this.audioUris };
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

  // ---------------------------------------------------------------------------

  private launch() {
    if (!this.wanted || !this.opts) return;
    const o = this.opts;
    this.utteranceStart = null;
    ExpoSpeechRecognitionModule.start({
      lang: o.locale,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: this.onDevice,
      addsPunctuation: false,
      contextualStrings: o.contextualStrings,
      iosTaskHint: "confirmation",
      volumeChangeEventOptions: { enabled: true, intervalMillis: 250 },
      ...(o.persistAudio ? { recordingOptions: { persist: true } } : {}),
    });
  }

  private attach() {
    this.detach();
    const M = ExpoSpeechRecognitionModule;
    this.subs.push(
      M.addListener("start", () => {
        this.restarts = 0;
        this.emitStatus("listening");
      }),
      M.addListener("speechstart", () => {
        this.utteranceStart = Date.now();
      }),
      M.addListener("result", (ev: { results?: Array<{ transcript: string; confidence?: number }>; isFinal?: boolean }) => {
        const best = ev.results?.[0];
        if (!best) return;
        if (this.utteranceStart === null) this.utteranceStart = Date.now();
        const u: RecognizedUtterance = {
          transcript: best.transcript,
          isFinal: !!ev.isFinal,
          startedAt: this.utteranceStart,
          confidence: typeof best.confidence === "number" && best.confidence >= 0 ? best.confidence : null,
        };
        for (const cb of this.utteranceCbs) cb(u);
        if (ev.isFinal) this.utteranceStart = null;
      }),
      M.addListener("volumechange", (ev: { value: number }) => {
        // The module reports roughly -2…10; map to 0–1 for the meter.
        const level = Math.max(0, Math.min(1, (ev.value + 2) / 12));
        for (const cb of this.levelCbs) cb(level);
      }),
      M.addListener("audiostart", (ev: { uri?: string | null }) => {
        if (ev.uri) this.audioUris.push(ev.uri);
      }),
      M.addListener("end", () => this.scheduleRestart("end")),
      M.addListener("error", (ev: { error?: string; message?: string }) => {
        const code = ev.error ?? "error";
        // no-speech / aborted are routine in a gym; everything else is worth showing.
        if (code === "no-speech" || code === "aborted" || code === "speech-timeout") {
          this.scheduleRestart(code);
        } else {
          this.emitStatus("error", ev.message ?? code);
          this.scheduleRestart(code);
        }
      }),
    );
  }

  private detach() {
    for (const s of this.subs) s.remove();
    this.subs = [];
  }

  private scheduleRestart(reason: string) {
    if (!this.wanted) return;
    const delay = BACKOFF_MS[Math.min(this.restarts, BACKOFF_MS.length - 1)];
    this.restarts += 1;
    this.emitStatus("restarting", reason);
    setTimeout(() => this.launch(), delay);
  }

  private emitStatus(s: RecognizerStatus, detail?: string) {
    for (const cb of this.statusCbs) cb(s, detail);
  }
}

// ---------------------------------------------------------------------------
// Voice adapter interface (PRD FR-1.4 / FR-1.6).
//
// The voice layer is pluggable: a common interface with at least two
// interchangeable adapters (cloud + local) is planned for later phases.
// Phase 0 ships only the interface plus a text-only fallback adapter, so
// JARVIS can run with zero voice configuration (FR-1.6) and the UI can
// disclose where audio is (or isn't) being processed (FR-1.4).
// ---------------------------------------------------------------------------

export type VoiceProcessingLocation = "none" | "local" | "cloud";

export interface TranscriptionResult {
  text: string;
}

export interface SynthesisResult {
  /** Whether audio was actually produced. Text-only adapters return false. */
  audioProduced: boolean;
}

/**
 * Common interface every voice adapter implements. Phase 0's only adapter
 * is `TextOnlyVoiceAdapter`, which never produces or consumes audio - it
 * exists so the seam (and the UI's "where is audio processed" disclosure)
 * is in place before real STT/TTS adapters land.
 */
export interface VoiceAdapter {
  /** Stable identifier shown in settings (e.g. "text", "cloud", "local"). */
  readonly id: string;
  /** Human-readable name for the UI. */
  readonly name: string;
  /** Where audio is processed, for the FR-1.4 disclosure requirement. */
  readonly processingLocation: VoiceProcessingLocation;
  /** Whether this adapter can actually capture/transcribe audio. */
  readonly supportsInput: boolean;
  /** Whether this adapter can actually synthesize/play audio. */
  readonly supportsOutput: boolean;

  /** Transcribe audio to text. Adapters without input support should reject. */
  transcribe(audio: Buffer): Promise<TranscriptionResult>;

  /** Synthesize speech for the given text. */
  synthesize(text: string): Promise<SynthesisResult>;
}

/**
 * Text-only fallback adapter (FR-1.6). Used when no voice services are
 * configured/available, or when `JARVIS_VOICE_ADAPTER=text` (the default).
 * The UI should treat this as "voice unavailable - text chat only".
 */
export class TextOnlyVoiceAdapter implements VoiceAdapter {
  readonly id = "text";
  readonly name = "Text-only (no voice)";
  readonly processingLocation: VoiceProcessingLocation = "none";
  readonly supportsInput = false;
  readonly supportsOutput = false;

  async transcribe(): Promise<TranscriptionResult> {
    throw new Error("TextOnlyVoiceAdapter does not support audio transcription.");
  }

  async synthesize(): Promise<SynthesisResult> {
    return { audioProduced: false };
  }
}

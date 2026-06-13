// ---------------------------------------------------------------------------
// Public surface for the /voice module.
// ---------------------------------------------------------------------------

import { config } from "../config";
import { TextOnlyVoiceAdapter, type VoiceAdapter } from "./adapter";

export * from "./adapter";

/**
 * Resolve the active voice adapter from config. Phase 0 only ships the
 * text-only adapter regardless of `JARVIS_VOICE_ADAPTER` - later phases add
 * real cloud/local adapters and switch on `config.voiceAdapter` here.
 */
export function getVoiceAdapter(): VoiceAdapter {
  // Both "text" and "stub" resolve to the text-only adapter in Phase 0.
  void config.voiceAdapter;
  return new TextOnlyVoiceAdapter();
}

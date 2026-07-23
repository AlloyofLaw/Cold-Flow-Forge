// Neutral default tunables. These are MECHANICS defaults only — never the
// user's performance data. All are editable in Settings.
import type { XpConstants, Settings } from '../types';
import { defaultBarFor, defaultPlatesFor } from './plateMath';

export const DEFAULT_XP_CONSTANTS: XpConstants = {
  BASE_SET_XP: 10,
  VOLUME_DIVISOR: 100,
  PR_BONUS_XP: 25,
  SURPRISE_PROBABILITY: 0.17, // ~15-20% of qualifying logged sets
  SURPRISE_MULTIPLIER: 2,
  BOOTSTRAP_DAYS: 21, // continuous reinforcement window
  SUSTAIN_TO_FADE_DAYS: 42,
};

export function defaultSettings(): Settings {
  const unit = 'lb';
  return {
    id: 'singleton',
    barWeight: defaultBarFor(unit),
    plateInventory: defaultPlatesFor(unit),
    unit,
    weeklyTarget: 4,
    restTimerDefault: 120,
    fadePhaseMode: 'auto',
    xpConstants: { ...DEFAULT_XP_CONSTANTS },
    soundEnabled: true,
    hapticEnabled: true,
    reminderEnabled: true,
  };
}

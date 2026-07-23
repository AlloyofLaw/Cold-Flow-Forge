// Seed data: ONLY the track definitions and exercise catalog. No user
// performance data (no PRs, no body weight, no targets) is ever seeded.
import type { Track } from '../types';

export const TRACK_DEFS: Omit<Track, 'xp' | 'level' | 'phase' | 'tierProgress' | 'activeDays' | 'startedAt'>[] = [
  { id: 'push', name: 'Push' },
  { id: 'pull', name: 'Pull' },
  { id: 'legs', name: 'Legs' },
  { id: 'core', name: 'Core' },
  { id: 'squat', name: 'Squat' },
  { id: 'bench', name: 'Bench Press' },
  { id: 'deadlift', name: 'Deadlift' },
  { id: 'ohp', name: 'Overhead Press' },
];

export interface SeedExercise {
  name: string;
  trackId: string;
  category: string;
}

export const EXERCISE_CATALOG: SeedExercise[] = [
  // Primary barbell lifts -> dedicated tracks
  { name: 'Back Squat', trackId: 'squat', category: 'Barbell' },
  { name: 'Front Squat', trackId: 'squat', category: 'Barbell' },
  { name: 'Bench Press', trackId: 'bench', category: 'Barbell' },
  { name: 'Incline Bench Press', trackId: 'bench', category: 'Barbell' },
  { name: 'Deadlift', trackId: 'deadlift', category: 'Barbell' },
  { name: 'Romanian Deadlift', trackId: 'deadlift', category: 'Barbell' },
  { name: 'Overhead Press', trackId: 'ohp', category: 'Barbell' },
  { name: 'Push Press', trackId: 'ohp', category: 'Barbell' },

  // Push
  { name: 'Dumbbell Bench Press', trackId: 'push', category: 'Dumbbell' },
  { name: 'Dumbbell Shoulder Press', trackId: 'push', category: 'Dumbbell' },
  { name: 'Dip', trackId: 'push', category: 'Bodyweight' },
  { name: 'Cable Triceps Pushdown', trackId: 'push', category: 'Machine' },
  { name: 'Machine Chest Press', trackId: 'push', category: 'Machine' },
  { name: 'Lateral Raise', trackId: 'push', category: 'Dumbbell' },

  // Pull
  { name: 'Pull-Up', trackId: 'pull', category: 'Bodyweight' },
  { name: 'Chin-Up', trackId: 'pull', category: 'Bodyweight' },
  { name: 'Barbell Row', trackId: 'pull', category: 'Barbell' },
  { name: 'Dumbbell Row', trackId: 'pull', category: 'Dumbbell' },
  { name: 'Lat Pulldown', trackId: 'pull', category: 'Machine' },
  { name: 'Seated Cable Row', trackId: 'pull', category: 'Machine' },
  { name: 'Barbell Curl', trackId: 'pull', category: 'Barbell' },
  { name: 'Dumbbell Curl', trackId: 'pull', category: 'Dumbbell' },
  { name: 'Face Pull', trackId: 'pull', category: 'Machine' },

  // Legs
  { name: 'Leg Press', trackId: 'legs', category: 'Machine' },
  { name: 'Walking Lunge', trackId: 'legs', category: 'Dumbbell' },
  { name: 'Bulgarian Split Squat', trackId: 'legs', category: 'Dumbbell' },
  { name: 'Leg Extension', trackId: 'legs', category: 'Machine' },
  { name: 'Leg Curl', trackId: 'legs', category: 'Machine' },
  { name: 'Standing Calf Raise', trackId: 'legs', category: 'Machine' },
  { name: 'Hip Thrust', trackId: 'legs', category: 'Barbell' },

  // Core
  { name: 'Hanging Leg Raise', trackId: 'core', category: 'Bodyweight' },
  { name: 'Cable Crunch', trackId: 'core', category: 'Machine' },
  { name: 'Plank', trackId: 'core', category: 'Bodyweight' },
  { name: 'Ab Wheel Rollout', trackId: 'core', category: 'Bodyweight' },
  { name: 'Russian Twist', trackId: 'core', category: 'Dumbbell' },
];

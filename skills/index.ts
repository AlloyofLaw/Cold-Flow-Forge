// ---------------------------------------------------------------------------
// Public surface for the /skills module.
// ---------------------------------------------------------------------------

export * from "./registry";
export * from "./mcpClient";

import { registerGoogleCalendarSkill } from "./google-calendar";
import { registerGmailSkill } from "./gmail";

/**
 * Connect and register every built-in skill (FR-7.1). Phase 2 has two:
 * Google Calendar (read + write events) and Gmail (read + draft). Called
 * once at app startup (app/main.ts) and by tests that need a populated
 * registry.
 *
 * Each skill's `register*Skill()` function handles its own stub mode, so
 * this always succeeds even with zero external accounts configured.
 */
export async function registerAllSkills(): Promise<void> {
  await registerGoogleCalendarSkill();
  await registerGmailSkill();
}

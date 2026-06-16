// ---------------------------------------------------------------------------
// Public surface for the /skills module.
// ---------------------------------------------------------------------------

export * from "./registry";
export * from "./mcpClient";

import { registerGoogleCalendarSkill } from "./google-calendar";
import { registerGmailSkill } from "./gmail";
import { registerStripeSkill } from "./stripe";
import { registerFilesystemSkill } from "./filesystem";

/**
 * Connect and register every built-in skill (FR-7.1). Phase 4 has four:
 * Google Calendar (read + write events), Gmail (read + draft + send),
 * Stripe (read + Tier 3 refunds/cancellations, test mode), and the Local
 * Filesystem skill (FR-6.1..6.7, scoped to config.allowedDirectory). Called
 * once at app startup (app/main.ts) and by tests that need a populated
 * registry.
 *
 * Each skill's `register*Skill()` function handles its own stub mode (or, for
 * the filesystem skill, ensures its allowed directory exists), so this always
 * succeeds even with zero external accounts configured.
 */
export async function registerAllSkills(): Promise<void> {
  await registerGoogleCalendarSkill();
  await registerGmailSkill();
  await registerStripeSkill();
  await registerFilesystemSkill();
}

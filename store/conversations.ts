// ---------------------------------------------------------------------------
// Conversation transcript access (PRD Section 12: conversations table).
// ---------------------------------------------------------------------------

import type { Database } from "better-sqlite3";
import { getDb } from "./database";

export type ConversationRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  id: number;
  sessionId: string;
  role: ConversationRole;
  content: string;
  createdAt: string;
}

interface ConversationRow {
  id: number;
  session_id: string;
  role: ConversationRole;
  content: string;
  created_at: string;
}

function rowToMessage(row: ConversationRow): ConversationMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

/** Append a message to the conversation transcript. Returns the new row id. */
export function recordMessage(
  sessionId: string,
  role: ConversationRole,
  content: string,
  database: Database = getDb(),
): number {
  const stmt = database.prepare(
    `INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)`,
  );
  const info = stmt.run(sessionId, role, content);
  return Number(info.lastInsertRowid);
}

/** Fetch all messages for a session, oldest first. */
export function getSessionMessages(
  sessionId: string,
  database: Database = getDb(),
): ConversationMessage[] {
  const rows = database
    .prepare(`SELECT * FROM conversations WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId) as ConversationRow[];

  return rows.map(rowToMessage);
}

/** Fetch the most recent messages across all sessions, newest first. */
export function listRecentMessages(
  limit = 50,
  database: Database = getDb(),
): ConversationMessage[] {
  const rows = database
    .prepare(`SELECT * FROM conversations ORDER BY id DESC LIMIT ?`)
    .all(limit) as ConversationRow[];

  return rows.map(rowToMessage);
}

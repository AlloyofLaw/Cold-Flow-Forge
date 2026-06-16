// ---------------------------------------------------------------------------
// Gmail MCP server (PRD Section 6.4, FR-4.1-4.3/4.5, SEC-9).
//
// A self-contained MCP server we control (per SEC-9), wrapping the official
// `googleapis` Gmail v1 client using OAuth 2.0 with the
// `gmail.readonly` + `gmail.compose` scopes (see auth.ts).
//
// Tools exposed:
//   READ (Tier 0, FR-4.2):
//   - search_messages: search mail by query (sender/subject/date/keyword).
//   - read_message:    full content of a single message.
//   - read_thread:     full content of a thread (all messages in it).
//   - list_unread:     unread messages in the inbox.
//   - summarize_inbox: a compact summary of recent inbox messages (subject,
//                       sender, snippet, unread flag) for "what's in my
//                       inbox" style requests.
//
//   DRAFT (Tier 1, FR-4.3):
//   - create_draft: create a Gmail draft (saved, NOT sent).
//
//   TRIAGE (Tier 1, FR-4.5, reversible):
//   - mark_read:     mark a message as read (removes UNREAD label).
//   - label_message: add/remove labels on a message.
//
//   SEND (Tier 2, FR-4.4, Phase 3):
//   - send_email: send a real email - either composed fresh (to/cc/bcc/
//     subject/body) or from an existing draft (draftId). ALWAYS requires
//     the user's confirmation (core/permissions.ts TIER_ASSIGNMENTS +
//     describeGmailToolCall) - this is the FIRST capability in JARVIS that
//     can send something irreversible to other people, so there is no
//     argument-aware downgrade: every call is Tier 2, no exceptions.
//
// EXPLICITLY NOT IMPLEMENTED (per FR-4.6 and PRD Section 14):
//   - No delete/trash/permanently-delete tool.
//
// Stub mode (no Google OAuth credentials configured, or not yet authorized):
// every tool still registers and returns a clearly-labeled stub/empty result
// instead of throwing, so the app loads and `npm test` passes with zero
// Google account - mirroring skills/google-calendar/server.ts.
//
// This server is run IN-PROCESS (see index.ts), connected to its client via
// `InMemoryTransport`, exactly like the Google Calendar skill.
// ---------------------------------------------------------------------------

import { gmail_v1, google } from "googleapis";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGmailAuth } from "./auth";

export const GMAIL_SKILL_ID = "gmail";

const STUB_NOTICE =
  "[STUB] No Gmail account is connected yet. " +
  "See README 'Connect Gmail' to authorize one. " +
  "This is a placeholder result, not real mailbox data.";

/** A single message summary (FR-4.2). */
export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  unread: boolean;
  labels: string[];
}

/** Full message content, including body text (FR-4.2 "read full message content"). */
export interface GmailMessageDetail extends GmailMessageSummary {
  body: string;
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const header = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? "";
}

/** Recursively extract plain-text body content from a message payload. */
function extractBody(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";

  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  }

  if (part.parts) {
    for (const child of part.parts) {
      const text = extractBody(child);
      if (text) return text;
    }
  }

  // Fall back to HTML if no plain-text part was found.
  if (part.mimeType === "text/html" && part.body?.data) {
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  }

  return "";
}

function messageToSummary(message: gmail_v1.Schema$Message): GmailMessageSummary {
  const headers = message.payload?.headers;
  const labels = message.labelIds ?? [];

  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    subject: headerValue(headers, "Subject") || "(no subject)",
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    date: headerValue(headers, "Date"),
    snippet: message.snippet ?? "",
    unread: labels.includes("UNREAD"),
    labels,
  };
}

function messageToDetail(message: gmail_v1.Schema$Message): GmailMessageDetail {
  return {
    ...messageToSummary(message),
    body: extractBody(message.payload),
  };
}

/** Build a raw RFC 2822 message for a draft or send (FR-4.3, FR-4.4). */
function buildRawMessage(to: string[], cc: string[] | undefined, subject: string, body: string, bcc?: string[]): string {
  const lines = [`To: ${to.join(", ")}`];
  if (cc && cc.length > 0) lines.push(`Cc: ${cc.join(", ")}`);
  if (bcc && bcc.length > 0) lines.push(`Bcc: ${bcc.join(", ")}`);
  lines.push(`Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body);
  const message = lines.join("\r\n");
  return Buffer.from(message).toString("base64url");
}

/**
 * Build the Gmail MCP server.
 *
 * Auth/client construction is lazy and re-checked on every tool call (not
 * cached at server-build time), mirroring skills/google-calendar/server.ts:
 * this lets a user authorize Google after JARVIS has started, and means a
 * revoked token is detected on the next call.
 */
export function createGmailServer(): McpServer {
  const server = new McpServer({ name: "jarvis-gmail", version: "0.1.0" });

  server.registerTool(
    "search_messages",
    {
      title: "Search Gmail messages",
      description:
        "Search Gmail using Gmail's search syntax (e.g. 'from:sarah@example.com', 'subject:invoice', " +
        "'is:unread', 'after:2026/06/01'). Read-only (FR-4.2). Returns message summaries " +
        "(subject, from, to, date, snippet, unread flag, labels) without fetching full bodies.",
      inputSchema: {
        query: z.string().describe("Gmail search query string."),
        maxResults: z.number().int().min(1).max(100).optional().describe("Maximum number of messages to return (default 20)."),
      },
    },
    async ({ query, maxResults }) => {
      const auth = await getGmailAuth();
      if (!auth) {
        return { content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, query, messages: [] }) }] };
      }

      try {
        const gmail = google.gmail({ version: "v1", auth });
        const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: maxResults ?? 20 });

        const messages: GmailMessageSummary[] = [];
        for (const item of list.data.messages ?? []) {
          if (!item.id) continue;
          const full = await gmail.users.messages.get({ userId: "me", id: item.id, format: "metadata" });
          messages.push(messageToSummary(full.data));
        }

        return { content: [{ type: "text", text: JSON.stringify({ stub: false, query, messages }) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to search Gmail: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "read_message",
    {
      title: "Read a Gmail message",
      description:
        "Read the full content (subject, from, to, date, body text) of a single Gmail message by id " +
        "(read-only, FR-4.2). Get the message id from search_messages or list_unread.",
      inputSchema: {
        messageId: z.string().describe("The Gmail message id to read."),
      },
    },
    async ({ messageId }) => {
      const auth = await getGmailAuth();
      if (!auth) {
        return { content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, messageId }) }] };
      }

      try {
        const gmail = google.gmail({ version: "v1", auth });
        const full = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
        return { content: [{ type: "text", text: JSON.stringify({ stub: false, message: messageToDetail(full.data) }) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to read Gmail message: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "read_thread",
    {
      title: "Read a Gmail thread",
      description:
        "Read the full content of every message in a Gmail thread by thread id (read-only, FR-4.2). " +
        "Useful for reading an entire email conversation.",
      inputSchema: {
        threadId: z.string().describe("The Gmail thread id to read."),
      },
    },
    async ({ threadId }) => {
      const auth = await getGmailAuth();
      if (!auth) {
        return { content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, threadId, messages: [] }) }] };
      }

      try {
        const gmail = google.gmail({ version: "v1", auth });
        const thread = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
        const messages = (thread.data.messages ?? []).map(messageToDetail);
        return { content: [{ type: "text", text: JSON.stringify({ stub: false, threadId, messages }) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to read Gmail thread: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_unread",
    {
      title: "List unread Gmail messages",
      description: "List unread messages in the inbox (read-only, FR-4.2). Returns message summaries.",
      inputSchema: {
        maxResults: z.number().int().min(1).max(100).optional().describe("Maximum number of messages to return (default 20)."),
      },
    },
    async ({ maxResults }) => {
      const auth = await getGmailAuth();
      if (!auth) {
        return { content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, messages: [] }) }] };
      }

      try {
        const gmail = google.gmail({ version: "v1", auth });
        const list = await gmail.users.messages.list({
          userId: "me",
          q: "is:unread",
          labelIds: ["INBOX"],
          maxResults: maxResults ?? 20,
        });

        const messages: GmailMessageSummary[] = [];
        for (const item of list.data.messages ?? []) {
          if (!item.id) continue;
          const full = await gmail.users.messages.get({ userId: "me", id: item.id, format: "metadata" });
          messages.push(messageToSummary(full.data));
        }

        return { content: [{ type: "text", text: JSON.stringify({ stub: false, messages }) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list unread Gmail messages: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "summarize_inbox",
    {
      title: "Summarize Gmail inbox",
      description:
        "Get a compact summary of the most recent inbox messages (subject, sender, snippet, unread " +
        "flag) for an overview like 'what's in my inbox?' or 'anything urgent?' (read-only, FR-4.2).",
      inputSchema: {
        maxResults: z.number().int().min(1).max(50).optional().describe("Maximum number of messages to summarize (default 10)."),
      },
    },
    async ({ maxResults }) => {
      const auth = await getGmailAuth();
      if (!auth) {
        return { content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, messages: [] }) }] };
      }

      try {
        const gmail = google.gmail({ version: "v1", auth });
        const list = await gmail.users.messages.list({ userId: "me", labelIds: ["INBOX"], maxResults: maxResults ?? 10 });

        const messages: GmailMessageSummary[] = [];
        for (const item of list.data.messages ?? []) {
          if (!item.id) continue;
          const full = await gmail.users.messages.get({ userId: "me", id: item.id, format: "metadata" });
          messages.push(messageToSummary(full.data));
        }

        return { content: [{ type: "text", text: JSON.stringify({ stub: false, messages }) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to summarize Gmail inbox: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "create_draft",
    {
      title: "Create a Gmail draft",
      description:
        "Create a Gmail draft email (Tier 1: reversible, internal-only - FR-4.3). The draft is SAVED " +
        "to the user's Drafts folder, NOT sent. There is no tool to send email - sending is a future " +
        "phase and always requires separate, explicit confirmation.",
      inputSchema: {
        to: z.array(z.string()).min(1).describe("Recipient email addresses."),
        cc: z.array(z.string()).optional().describe("CC email addresses."),
        subject: z.string().describe("Email subject."),
        body: z.string().describe("Email body (plain text)."),
      },
    },
    async ({ to, cc, subject, body }) => {
      const auth = await getGmailAuth();
      if (!auth) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, wouldCreateDraft: { to, cc, subject, body } }) },
          ],
        };
      }

      try {
        const gmail = google.gmail({ version: "v1", auth });
        const raw = buildRawMessage(to, cc, subject, body);
        const draft = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stub: false,
                draft: { id: draft.data.id, messageId: draft.data.message?.id, to, cc: cc ?? [], subject },
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to create Gmail draft: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "send_email",
    {
      title: "Send a Gmail email",
      description:
        "SEND a real email (Tier 2, FR-4.4) - ALWAYS requires the user's explicit confirmation " +
        "before this runs, with no exceptions. This action cannot be unsent. Either compose a new " +
        "message (provide to/subject/body, with optional cc/bcc) or send an existing draft by " +
        "providing `draftId` (from create_draft). Uses the `gmail.compose` OAuth scope, which covers " +
        "both creating drafts and sending them via gmail.users.drafts.send.",
      inputSchema: {
        draftId: z
          .string()
          .optional()
          .describe("If set, send this existing draft (from create_draft) instead of composing a new message."),
        to: z.array(z.string()).optional().describe("Recipient email addresses (required unless draftId is set)."),
        cc: z.array(z.string()).optional().describe("CC email addresses."),
        bcc: z.array(z.string()).optional().describe("BCC email addresses."),
        subject: z.string().optional().describe("Email subject (required unless draftId is set)."),
        body: z.string().optional().describe("Email body, plain text (required unless draftId is set)."),
      },
    },
    async ({ draftId, to, cc, bcc, subject, body }) => {
      const auth = await getGmailAuth();
      if (!auth) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stub: true,
                notice: STUB_NOTICE,
                wouldSend: draftId ? { draftId } : { to: to ?? [], cc: cc ?? [], bcc: bcc ?? [], subject, body },
              }),
            },
          ],
        };
      }

      try {
        const gmail = google.gmail({ version: "v1", auth });

        if (draftId) {
          const sent = await gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
          return {
            content: [
              { type: "text", text: JSON.stringify({ stub: false, sent: true, messageId: sent.data.id, draftId }) },
            ],
          };
        }

        if (!to || to.length === 0 || !subject || body === undefined) {
          return {
            content: [{ type: "text", text: "send_email requires either draftId, or to/subject/body to compose a new message." }],
            isError: true,
          };
        }

        const raw = buildRawMessage(to, cc, subject, body, bcc);
        const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ stub: false, sent: true, messageId: sent.data.id, to, cc: cc ?? [], bcc: bcc ?? [], subject }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to send Gmail message: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "mark_read",
    {
      title: "Mark Gmail message as read",
      description:
        "Mark a message as read by removing its UNREAD label (Tier 1: reversible triage, FR-4.5). " +
        "Does not delete or move the message.",
      inputSchema: {
        messageId: z.string().describe("The Gmail message id to mark as read."),
      },
    },
    async ({ messageId }) => {
      const auth = await getGmailAuth();
      if (!auth) {
        return { content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, messageId }) }] };
      }

      try {
        const gmail = google.gmail({ version: "v1", auth });
        await gmail.users.messages.modify({ userId: "me", id: messageId, requestBody: { removeLabelIds: ["UNREAD"] } });
        return { content: [{ type: "text", text: JSON.stringify({ stub: false, messageId, markedRead: true }) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to mark Gmail message as read: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "label_message",
    {
      title: "Label a Gmail message",
      description:
        "Add and/or remove labels on a Gmail message (Tier 1: reversible triage, FR-4.5). Does not " +
        "delete or move the message to trash - use Gmail labels like 'IMPORTANT', 'STARRED', or any " +
        "custom label name. There is no tool to delete or trash messages.",
      inputSchema: {
        messageId: z.string().describe("The Gmail message id to label."),
        addLabels: z.array(z.string()).optional().describe("Label ids/names to add (e.g. 'IMPORTANT', 'STARRED')."),
        removeLabels: z.array(z.string()).optional().describe("Label ids/names to remove."),
      },
    },
    async ({ messageId, addLabels, removeLabels }) => {
      const auth = await getGmailAuth();
      if (!auth) {
        return { content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, messageId, addLabels, removeLabels }) }] };
      }

      try {
        const gmail = google.gmail({ version: "v1", auth });
        await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: { addLabelIds: addLabels ?? [], removeLabelIds: removeLabels ?? [] },
        });
        return { content: [{ type: "text", text: JSON.stringify({ stub: false, messageId, addLabels: addLabels ?? [], removeLabels: removeLabels ?? [] }) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to label Gmail message: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

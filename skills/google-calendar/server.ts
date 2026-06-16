// ---------------------------------------------------------------------------
// Google Calendar MCP server (PRD Section 6.3, FR-3.1-FR-3.5, SEC-9).
//
// A self-contained MCP server we control (per SEC-9, rather than an unvetted
// third-party `npx` server). It wraps the official `googleapis` Calendar v3
// client using OAuth 2.0 with the `https://www.googleapis.com/auth/calendar.events`
// scope (read+write of events - see auth.ts).
//
// Tools exposed:
//   READ (Tier 0, FR-3.2):
//   - list_calendars: the user's calendar list (id, name, primary flag, time zone).
//   - list_events:    events in a date/time range for a calendar, with
//                      start/end/title/attendees - enough for the Brain to
//                      answer "what's on my calendar today?" (FR-3.2, FR-3.5).
//
//   WRITE (Phase 2, FR-3.3/3.4 - tier depends on arguments, see
//   core/permissions.ts CLASSIFIER_HOOKS):
//   - create_event: create a new event. No attendees = Tier 1 (personal,
//     reversible); with attendees = Tier 2 (notifies other people).
//   - update_event: edit/move/reschedule an existing event, and/or
//     add/remove attendees. Same Tier 1/2 split as create_event.
//   - delete_event: permanently delete an event. Always Tier 2 regardless of
//     attendees (hard to reverse).
//   All write tools perform a best-effort conflict check against existing
//   events on the target calendar and surface any overlap via
//   `conflictWarning` in their result, so the confirmation description
//   (core/permissions.ts `describeToolCall`) can flag double-bookings
//   (FR-3.3 / Edge Cases table) BEFORE the user confirms.
//
// Stub mode (no Google OAuth credentials configured, or not yet authorized):
// every tool still registers and returns a clearly-labeled stub/empty result
// instead of throwing, so the app loads and `npm test` passes with zero
// Google account - mirroring the Phase 0 stub-mode pattern in core/brain.ts.
// Write tools in stub mode perform NO real API call and clearly label their
// result as a stub.
//
// This server is run IN-PROCESS (see index.ts), connected to its client via
// `InMemoryTransport` - no subprocess/stdio needed for a server we wrote and
// trust ourselves. See index.ts for why this transport was chosen.
// ---------------------------------------------------------------------------

import { calendar_v3, google } from "googleapis";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../../config";
import { getCalendarAuth } from "./auth";

export const GOOGLE_CALENDAR_SKILL_ID = "google-calendar";

const STUB_NOTICE =
  "[STUB] No Google Calendar account is connected yet. " +
  "See README 'Connect your Google Calendar' to authorize one. " +
  "This is a placeholder result, not real calendar data.";

/** A single event as returned to the Brain (FR-3.2: title/start/end/attendees). */
export interface CalendarEventSummary {
  id: string;
  title: string;
  /** ISO 8601 timestamp, in the calendar's (or user's configured) time zone offset. */
  start: string | undefined;
  end: string | undefined;
  /** Whether `start`/`end` are date-only (all-day event) vs date-time. */
  allDay: boolean;
  location: string | undefined;
  attendees: string[];
  /** The IANA time zone the start/end times are expressed in (FR-3.5). */
  timeZone: string;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
  timeZone: string | undefined;
}

function eventToSummary(event: calendar_v3.Schema$Event, fallbackTimeZone: string): CalendarEventSummary {
  const start = event.start;
  const end = event.end;
  const allDay = Boolean(start?.date && !start?.dateTime);

  return {
    id: event.id ?? "",
    title: event.summary ?? "(no title)",
    start: start?.dateTime ?? start?.date ?? undefined,
    end: end?.dateTime ?? end?.date ?? undefined,
    allDay,
    location: event.location ?? undefined,
    attendees: (event.attendees ?? []).map((a) => a.email ?? a.displayName ?? "unknown").filter(Boolean),
    timeZone: start?.timeZone ?? end?.timeZone ?? fallbackTimeZone,
  };
}

/**
 * Build the Google Calendar MCP server.
 *
 * Auth/client construction is lazy and re-checked on every tool call (not
 * cached at server-build time): this lets a user authorize Google *after*
 * JARVIS has started without needing a restart, and means a revoked token
 * (Edge Cases table: "user revokes access out-of-band") is detected on the
 * next call rather than baked into a stale client.
 */
export function createGoogleCalendarServer(): McpServer {
  const server = new McpServer({ name: "jarvis-google-calendar", version: "0.1.0" });

  server.registerTool(
    "list_calendars",
    {
      title: "List Google Calendars",
      description:
        "List the calendars on the user's Google account (read-only). Returns each " +
        "calendar's id, display name, whether it's the user's primary calendar, and " +
        "its time zone.",
      inputSchema: {},
    },
    async () => {
      const auth = await getCalendarAuth();
      if (!auth) {
        return {
          content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, calendars: [] }) }],
        };
      }

      try {
        const calendar = google.calendar({ version: "v3", auth });
        const res = await calendar.calendarList.list();
        const calendars: CalendarSummary[] = (res.data.items ?? []).map((item) => ({
          id: item.id ?? "",
          summary: item.summary ?? item.id ?? "(unnamed calendar)",
          primary: Boolean(item.primary),
          timeZone: item.timeZone ?? undefined,
        }));

        return { content: [{ type: "text", text: JSON.stringify({ stub: false, calendars }) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list Google calendars: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_events",
    {
      title: "List Google Calendar events",
      description:
        "List events on a Google Calendar between two times (read-only). Defaults to the " +
        "user's primary calendar and to 'today' (00:00-23:59:59) in the user's configured " +
        "time zone if timeMin/timeMax are omitted. Returns each event's id, title, " +
        "start/end (time-zone qualified), location, and attendee emails.",
      inputSchema: {
        calendarId: z
          .string()
          .optional()
          .describe('Calendar id to query, or "primary" for the user\'s main calendar. Defaults to "primary".'),
        timeMin: z
          .string()
          .optional()
          .describe(
            "Start of the range, as an ISO 8601 date-time (e.g. 2026-06-13T00:00:00-04:00). " +
              "Defaults to the start of today in the user's configured time zone.",
          ),
        timeMax: z
          .string()
          .optional()
          .describe(
            "End of the range, as an ISO 8601 date-time. Defaults to the end of today in the " +
              "user's configured time zone.",
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(250)
          .optional()
          .describe("Maximum number of events to return (default 50)."),
      },
    },
    async ({ calendarId, timeMin, timeMax, maxResults }) => {
      const tz = config.timeZone;
      const range = resolveTimeRange(timeMin, timeMax, tz);

      const auth = await getCalendarAuth();
      if (!auth) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stub: true,
                notice: STUB_NOTICE,
                timeZone: tz,
                range,
                events: [],
              }),
            },
          ],
        };
      }

      try {
        const calendar = google.calendar({ version: "v3", auth });
        const res = await calendar.events.list({
          calendarId: calendarId || "primary",
          timeMin: range.timeMin,
          timeMax: range.timeMax,
          maxResults: maxResults ?? 50,
          singleEvents: true,
          orderBy: "startTime",
        });

        const events = (res.data.items ?? []).map((event) => eventToSummary(event, tz));

        return {
          content: [{ type: "text", text: JSON.stringify({ stub: false, timeZone: tz, range, events }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list Google Calendar events: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  const eventArgsShape = {
    calendarId: z
      .string()
      .optional()
      .describe('Calendar id to act on, or "primary" for the user\'s main calendar. Defaults to "primary".'),
    title: z.string().optional().describe("Event title/summary."),
    start: z
      .string()
      .optional()
      .describe("Start date-time, ISO 8601 with UTC offset (e.g. 2026-06-15T14:00:00-04:00)."),
    end: z
      .string()
      .optional()
      .describe("End date-time, ISO 8601 with UTC offset (e.g. 2026-06-15T15:00:00-04:00)."),
    timeZone: z
      .string()
      .optional()
      .describe('IANA time zone for start/end (e.g. "America/New_York"). Defaults to the configured time zone.'),
    location: z.string().optional().describe("Event location, if any."),
    description: z.string().optional().describe("Event description/notes, if any."),
    attendees: z
      .array(z.string())
      .optional()
      .describe(
        "Attendee email addresses to invite/notify. A NON-EMPTY list makes this call Tier 2 " +
          "(requires the user's confirmation before it runs, and attendees are only notified after confirmation).",
      ),
  };

  server.registerTool(
    "create_event",
    {
      title: "Create Google Calendar event",
      description:
        "Create a new event on a Google Calendar (FR-3.3). Creating an event with NO attendees is " +
        "Tier 1 (personal, no confirmation needed by default). Creating an event WITH attendees is " +
        "Tier 2 - it requires the user's confirmation, and attendees are only notified/invited after " +
        "confirmation (FR-3.4). The result includes a `conflictWarning` if the new event overlaps an " +
        "existing event on the same calendar (FR-3.3).",
      inputSchema: eventArgsShape,
    },
    async ({ calendarId, title, start, end, timeZone, location, description, attendees }) => {
      const tz = timeZone || config.timeZone;
      const targetCalendarId = calendarId || "primary";

      const auth = await getCalendarAuth();
      if (!auth) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stub: true,
                notice: STUB_NOTICE,
                wouldCreate: { calendarId: targetCalendarId, title, start, end, timeZone: tz, attendees: attendees ?? [] },
              }),
            },
          ],
        };
      }

      try {
        const calendar = google.calendar({ version: "v3", auth });
        const conflictWarning = await findConflict(calendar, targetCalendarId, start, end, tz);

        const res = await calendar.events.insert({
          calendarId: targetCalendarId,
          sendUpdates: attendees && attendees.length > 0 ? "all" : "none",
          requestBody: {
            summary: title,
            location,
            description,
            start: start ? { dateTime: start, timeZone: tz } : undefined,
            end: end ? { dateTime: end, timeZone: tz } : undefined,
            attendees: (attendees ?? []).map((email) => ({ email })),
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stub: false,
                event: eventToSummary(res.data, tz),
                conflictWarning,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to create Google Calendar event: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "update_event",
    {
      title: "Update / move / reschedule Google Calendar event",
      description:
        "Update an existing event - change its title/time/location/description, move/reschedule it, " +
        "and/or add or remove attendees (FR-3.3). Updating an event with no attendee changes and the " +
        "event currently has no attendees is Tier 1; any call that adds/removes/notifies attendees " +
        "(via `attendees`, `addAttendees`, or `removeAttendees`) is Tier 2 and requires confirmation - " +
        "attendees are only notified after confirmation (FR-3.4). The result includes a " +
        "`conflictWarning` if the rescheduled time overlaps another existing event (FR-3.3).",
      inputSchema: {
        ...eventArgsShape,
        eventId: z.string().describe("The id of the event to update (from list_events)."),
        addAttendees: z.array(z.string()).optional().describe("Attendee email addresses to ADD and notify."),
        removeAttendees: z.array(z.string()).optional().describe("Attendee email addresses to REMOVE."),
      },
    },
    async ({
      calendarId,
      eventId,
      title,
      start,
      end,
      timeZone,
      location,
      description,
      attendees,
      addAttendees,
      removeAttendees,
    }) => {
      const tz = timeZone || config.timeZone;
      const targetCalendarId = calendarId || "primary";

      const auth = await getCalendarAuth();
      if (!auth) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stub: true,
                notice: STUB_NOTICE,
                wouldUpdate: {
                  calendarId: targetCalendarId,
                  eventId,
                  title,
                  start,
                  end,
                  timeZone: tz,
                  attendees,
                  addAttendees,
                  removeAttendees,
                },
              }),
            },
          ],
        };
      }

      try {
        const calendar = google.calendar({ version: "v3", auth });
        const existing = await calendar.events.get({ calendarId: targetCalendarId, eventId });

        const conflictWarning = start || end ? await findConflict(calendar, targetCalendarId, start, end, tz, eventId) : undefined;

        const existingAttendees = (existing.data.attendees ?? []).map((a) => ({ email: a.email }));
        const removeSet = new Set(removeAttendees ?? []);
        let nextAttendees = existingAttendees.filter((a) => a.email && !removeSet.has(a.email));
        for (const email of addAttendees ?? []) {
          if (!nextAttendees.some((a) => a.email === email)) nextAttendees.push({ email });
        }
        if (attendees) {
          nextAttendees = attendees.map((email) => ({ email }));
        }

        const attendeesChanged =
          (addAttendees && addAttendees.length > 0) ||
          (removeAttendees && removeAttendees.length > 0) ||
          attendees !== undefined;

        const res = await calendar.events.patch({
          calendarId: targetCalendarId,
          eventId,
          sendUpdates: attendeesChanged ? "all" : "none",
          requestBody: {
            summary: title,
            location,
            description,
            start: start ? { dateTime: start, timeZone: tz } : undefined,
            end: end ? { dateTime: end, timeZone: tz } : undefined,
            attendees: nextAttendees.length > 0 ? nextAttendees : undefined,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stub: false,
                event: eventToSummary(res.data, tz),
                conflictWarning,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to update Google Calendar event: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "delete_event",
    {
      title: "Delete Google Calendar event",
      description:
        "Permanently delete an event from a Google Calendar. ALWAYS Tier 2 (confirmation required), " +
        "regardless of whether the event has attendees - deletes are hard to reverse, and any " +
        "attendees are notified of the cancellation only after confirmation (FR-3.3/3.4).",
      inputSchema: {
        calendarId: z
          .string()
          .optional()
          .describe('Calendar id, or "primary" for the user\'s main calendar. Defaults to "primary".'),
        eventId: z.string().describe("The id of the event to delete (from list_events)."),
      },
    },
    async ({ calendarId, eventId }) => {
      const targetCalendarId = calendarId || "primary";

      const auth = await getCalendarAuth();
      if (!auth) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stub: true,
                notice: STUB_NOTICE,
                wouldDelete: { calendarId: targetCalendarId, eventId },
              }),
            },
          ],
        };
      }

      try {
        const calendar = google.calendar({ version: "v3", auth });
        await calendar.events.delete({ calendarId: targetCalendarId, eventId, sendUpdates: "all" });

        return {
          content: [{ type: "text", text: JSON.stringify({ stub: false, deleted: true, calendarId: targetCalendarId, eventId }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to delete Google Calendar event: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

/**
 * Best-effort conflict check (FR-3.3 / Edge Cases "two calendar events
 * conflict after a requested change"): list events overlapping
 * [start, end] on `calendarId` and, if any (other than `excludeEventId`,
 * for updates) are found, return a human-readable warning string. Returns
 * `undefined` if no start/end is given or no overlap is found.
 */
async function findConflict(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  start: string | undefined,
  end: string | undefined,
  timeZone: string,
  excludeEventId?: string,
): Promise<string | undefined> {
  if (!start || !end) return undefined;

  try {
    const res = await calendar.events.list({
      calendarId,
      timeMin: start,
      timeMax: end,
      singleEvents: true,
      orderBy: "startTime",
    });

    const overlapping = (res.data.items ?? []).filter((event) => event.id !== excludeEventId);
    if (overlapping.length === 0) return undefined;

    const summaries = overlapping.map((event) => eventToSummary(event, timeZone));
    const names = summaries.map((e) => `"${e.title}" (${e.start ?? "?"} - ${e.end ?? "?"})`).join(", ");
    return `This overlaps ${overlapping.length} existing event(s) on this calendar: ${names}.`;
  } catch {
    // Conflict checking is best-effort - never block the write tool itself
    // on a failed read.
    return undefined;
  }
}

/**
 * Resolve the [timeMin, timeMax] range used by `list_events`. If both are
 * provided, they're passed through unchanged. Otherwise defaults to "today"
 * (00:00:00 - 23:59:59) in `timeZone` (FR-3.5).
 */
export function resolveTimeRange(
  timeMin: string | undefined,
  timeMax: string | undefined,
  timeZone: string,
): { timeMin: string; timeMax: string } {
  if (timeMin && timeMax) return { timeMin, timeMax };

  const { start, end } = todayRangeInTimeZone(timeZone);
  return { timeMin: timeMin ?? start, timeMax: timeMax ?? end };
}

/**
 * Compute the start (00:00:00) and end (23:59:59.999) of "today" expressed
 * as ISO 8601 date-times with the correct UTC offset for `timeZone`
 * (FR-3.5: resolve "today" against the user's configured time zone, and
 * read times back with their time zone).
 */
export function todayRangeInTimeZone(timeZone: string): { start: string; end: string; date: string } {
  const now = new Date();

  // Get the Y-M-D in the target time zone using Intl, independent of the
  // host's own time zone.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const date = `${year}-${month}-${day}`;

  const offset = timeZoneOffsetString(timeZone, now);

  return {
    date,
    start: `${date}T00:00:00${offset}`,
    end: `${date}T23:59:59${offset}`,
  };
}

/**
 * Compute the UTC offset (e.g. "-04:00") for `timeZone` at instant `at`,
 * suitable for appending to an ISO 8601 local date-time.
 */
function timeZoneOffsetString(timeZone: string, at: Date): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  });

  const tzPart = dtf.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  // tzPart looks like "GMT-4", "GMT+5:30", or "GMT" (= UTC, offset +0).
  const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(tzPart);
  if (!match) return "+00:00";

  const sign = match[1].startsWith("-") ? "-" : "+";
  const hours = match[1].replace(/^[+-]/, "").padStart(2, "0");
  const minutes = match[2] ?? "00";

  return `${sign}${hours}:${minutes}`;
}

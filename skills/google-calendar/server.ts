// ---------------------------------------------------------------------------
// Google Calendar MCP server (PRD Section 6.3, FR-3.1-FR-3.2, FR-3.5, SEC-9).
//
// A self-contained, READ-ONLY MCP server we control (per SEC-9, rather than
// an unvetted third-party `npx` server). It wraps the official `googleapis`
// Calendar v3 client using OAuth 2.0 with ONLY the
// `https://www.googleapis.com/auth/calendar.readonly` scope (see auth.ts).
//
// Tools exposed:
//   - list_calendars: the user's calendar list (id, name, primary flag, time zone).
//   - list_events:    events in a date/time range for a calendar, with
//                      start/end/title/attendees - enough for the Brain to
//                      answer "what's on my calendar today?" (FR-3.2, FR-3.5).
//
// Stub mode (no Google OAuth credentials configured, or not yet authorized):
// both tools still register and return a clearly-labeled stub/empty result
// instead of throwing, so the app loads and `npm test` passes with zero
// Google account - mirroring the Phase 0 stub-mode pattern in core/brain.ts.
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

  return server;
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

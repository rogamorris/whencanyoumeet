import { Temporal } from "temporal-polyfill";
import { randomToken } from "./tokens.ts";
import type { InstantIso } from "./types.ts";
import { parseInstant } from "./time.ts";

function compactUtc(iso: InstantIso): string {
  const zdt = parseInstant(iso).toZonedDateTimeISO("UTC");
  const y = String(zdt.year).padStart(4, "0");
  const m = String(zdt.month).padStart(2, "0");
  const d = String(zdt.day).padStart(2, "0");
  const h = String(zdt.hour).padStart(2, "0");
  const min = String(zdt.minute).padStart(2, "0");
  const s = String(zdt.second).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

function fold(line: string): string {
  return line.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,");
}

export function toIcs(input: {
  title: string;
  start: InstantIso;
  end: InstantIso;
  location?: string | null;
}): string {
  const now = compactUtc(Temporal.Now.instant().toString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//When Can You Meet//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${compactUtc(input.start)}-${randomToken(8)}@whencanyoumeet`,
    `DTSTAMP:${now}`,
    `DTSTART:${compactUtc(input.start)}`,
    `DTEND:${compactUtc(input.end)}`,
    `SUMMARY:${fold(input.title)}`,
    "DESCRIPTION:This file is a calendar draft. It is not proof that invitations were sent.",
  ];
  if (input.location) lines.push(`LOCATION:${fold(input.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

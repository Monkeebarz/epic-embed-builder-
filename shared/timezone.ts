/**
 * Timezone helpers: all business timestamps are stored as UTC epoch millis.
 * The UI accepts and displays times in America/Chicago (CDT/CST).
 */
export const APP_TZ = "America/Chicago";

/**
 * Convert a "YYYY-MM-DDTHH:mm" local (America/Chicago) datetime string to UTC epoch millis.
 * Works without external libs by measuring the zone offset at that instant.
 */
export function chicagoLocalToUtcMs(local: string): number | null {
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  // First guess: treat the wall time as if it were UTC
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  // Find what wall-clock time that instant corresponds to in Chicago
  const offset1 = zoneOffsetMs(asUtc);
  let guess = asUtc - offset1;
  // Re-check offset at the guessed instant (handles DST boundaries)
  const offset2 = zoneOffsetMs(guess);
  if (offset1 !== offset2) guess = asUtc - offset2;
  return guess;
}

/** Offset of America/Chicago from UTC (in ms) at the given UTC instant. Negative means behind UTC. */
function zoneOffsetMs(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/** Convert UTC epoch millis to a "YYYY-MM-DDTHH:mm" string in America/Chicago (for datetime-local inputs). */
export function utcMsToChicagoLocal(utcMs: number | null | undefined): string {
  if (utcMs === null || utcMs === undefined) return "";
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** Human-readable Chicago time string, e.g. "Jul 12, 2026, 7:30 PM CDT". */
export function formatChicago(utcMs: number | null | undefined): string {
  if (utcMs === null || utcMs === undefined) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(utcMs));
}

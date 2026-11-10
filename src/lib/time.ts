/** All shop times are shown and compared in the demo city's timezone (San Jose, CA by default). */
export const APP_TZ = process.env.NEXT_PUBLIC_APP_TZ || "America/Los_Angeles";

export function hhmm(d: Date | string, tz = APP_TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
}

export function minutesOfDay(d: Date | string, tz = APP_TZ): number {
  const [h, m] = hhmm(d, tz).split(":").map(Number);
  return h * 60 + m;
}

export function prettyTime(d: Date | string, tz = APP_TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

/** Today's date at HH:MM in the app timezone, as a real instant. */
export function todayAt(time: string, tz = APP_TZ, now = new Date()): Date {
  const [h, m] = time.split(":").map(Number);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  // offset between tz wall-clock and UTC for "now"
  const wallNow = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  const offset = wallNow - Math.floor(now.getTime() / 60000) * 60000;
  const wallTarget = Date.UTC(+parts.year, +parts.month - 1, +parts.day, h, m || 0);
  return new Date(wallTarget - offset);
}

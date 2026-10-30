// Wall-clock maths for the job scheduler (AT-169, PRD §9.6.2).
//
// Every schedule in the register is written in SAST. Africa/Johannesburg is
// UTC+2 with no DST, so the offset is applied explicitly here rather than
// trusting the container's TZ — a wrong TZ would silently move every job.

export const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type SastParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  dow: number; // 0 = Sunday … 6 = Saturday
};

export function sastParts(at: Date): SastParts {
  const s = new Date(at.getTime() + SAST_OFFSET_MS);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
    dow: s.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of the SAST calendar day containing `at`. */
export function sastDate(at: Date): string {
  const p = sastParts(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** YYYY-MM-DDTHH:MM in SAST — the period key for sub-daily jobs. */
export function sastMinute(at: Date): string {
  const p = sastParts(at);
  return `${sastDate(at)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Midday SAST on the day `daysBack` days before the SAST day containing `at`. */
export function sastMiddayDaysBack(at: Date, daysBack: number): Date {
  const p = sastParts(at);
  const middayUtc = Date.UTC(p.year, p.month - 1, p.day, 12) - SAST_OFFSET_MS;
  return new Date(middayUtc - daysBack * DAY_MS);
}

/** Truncate to the start of the minute (UTC and SAST agree on minute boundaries). */
export function floorToMinute(at: Date): Date {
  return new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);
}

// ─── Cron expressions ─────────────────────────────────────────────────────────
// A deliberately small subset of 5-field cron: `minute hour day-of-month month
// day-of-week`, each field `*`, `*/n`, `n`, or a comma list of those. Enough for
// the seven jobs of §9.6.2; anything else is rejected at parse time.

type Field = (v: number) => boolean;

function parseField(src: string, min: number, max: number): Field {
  const parts = src.split(",").map((part): Field => {
    if (part === "*") return () => true;
    const step = /^\*\/(\d+)$/.exec(part);
    if (step) {
      const n = Number(step[1]);
      if (n < 1) throw new Error(`Bad cron step "${part}"`);
      return (v) => (v - min) % n === 0;
    }
    if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n < min || n > max) throw new Error(`Cron value ${n} outside ${min}-${max}`);
      return (v) => v === n;
    }
    throw new Error(`Unsupported cron field "${part}"`);
  });
  return (v) => parts.some((f) => f(v));
}

export type CronMatcher = (at: Date) => boolean;

/** Parse a cron expression evaluated in SAST. */
export function parseCron(expr: string): CronMatcher {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron "${expr}" must have 5 fields`);
  const [mi, h, dom, mo, dow] = [
    parseField(fields[0], 0, 59),
    parseField(fields[1], 0, 23),
    parseField(fields[2], 1, 31),
    parseField(fields[3], 1, 12),
    parseField(fields[4], 0, 6),
  ];
  return (at) => {
    const p = sastParts(at);
    return mi(p.minute) && h(p.hour) && dom(p.day) && mo(p.month) && dow(p.dow);
  };
}

/**
 * Every minute in (after, upTo] that the matcher fires on, oldest first.
 * Used by startup catch-up; the window is bounded by the caller.
 */
export function fireTimesBetween(matcher: CronMatcher, after: Date, upTo: Date): Date[] {
  const out: Date[] = [];
  let t = floorToMinute(after).getTime() + MINUTE_MS;
  const end = upTo.getTime();
  for (; t <= end; t += MINUTE_MS) {
    const d = new Date(t);
    if (matcher(d)) out.push(d);
  }
  return out;
}

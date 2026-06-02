// Operating hours display — owner: Nikao (task N4)
// Display-only. System NEVER rejects orders based on time (rule L04).
//
// TODO (G-backend): replace PLACEHOLDER_HOURS below with a call to
// getOperatingHours() from @/server/actions/hours once Gian ships that action.
// The action already exists in the DB seed (db/seed/hours.ts).

export interface OperatingHoursProps {
  className?: string;
}

// ─── Type (mirrors db/seed/hours.ts SeedHours shape) ─────────────────────────
interface OperatingHour {
  dayOfWeek: number; // 0=Sun … 6=Sat
  opensAt: string;   // "HH:mm"
  closesAt: string;  // "HH:mm"
  isClosed: boolean;
}

// ─── Placeholder data (matches the live seed in Supabase) ────────────────────
// Replace with: const result = await getOperatingHours(); once G-backend lands.
const PLACEHOLDER_HOURS: OperatingHour[] = [
  { dayOfWeek: 0, opensAt: "07:00", closesAt: "15:00", isClosed: false }, // Sun
  { dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Mon
  { dayOfWeek: 2, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Tue
  { dayOfWeek: 3, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Wed
  { dayOfWeek: 4, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Thu
  { dayOfWeek: 5, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Fri
  { dayOfWeek: 6, opensAt: "00:00", closesAt: "00:00", isClosed: true  }, // Sat
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const FAVO_TZ = "Africa/Johannesburg";

const DAY_NAMES: Record<number, string> = {
  0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
  4: "Thursday", 5: "Friday", 6: "Saturday",
};

// Display order: Mon–Fri, Sat, Sun
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function getCurrentJhbParts(): { dayOfWeek: number; minutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: FAVO_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr    = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr  = parts.find((p) => p.type === "minute")?.value ?? "0";

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    dayOfWeek: weekdayMap[weekdayStr] ?? 0,
    minutes: parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10),
  };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isOpenNow(row: OperatingHour, todayDow: number, nowMinutes: number): boolean {
  if (row.isClosed || row.dayOfWeek !== todayDow) return false;
  return nowMinutes >= timeToMinutes(row.opensAt) && nowMinutes < timeToMinutes(row.closesAt);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function OperatingHours({ className }: OperatingHoursProps) {
  const data = PLACEHOLDER_HOURS;
  const byDay = new Map<number, OperatingHour>(data.map((r) => [r.dayOfWeek, r]));
  const { dayOfWeek: todayDow, minutes: nowMinutes } = getCurrentJhbParts();

  return (
    <section className={className} aria-label="Operating hours">
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {DISPLAY_ORDER.map((dow) => {
          const row     = byDay.get(dow);
          const dayName = DAY_NAMES[dow] ?? String(dow);
          const isToday = dow === todayDow;
          const openNow = row ? isOpenNow(row, todayDow, nowMinutes) : false;
          const timeLabel = !row
            ? "—"
            : row.isClosed
            ? "Closed"
            : `${row.opensAt} – ${row.closesAt}`;

          return (
            <li
              key={dow}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.375rem 0",
                borderBottom: "1px solid var(--color-porcelain-soft)",
                color: isToday ? "var(--color-coffee-bean)" : "var(--color-cool-steel)",
                fontWeight: isToday ? 600 : 400,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {openNow && (
                  <span
                    aria-label="Open now"
                    style={{
                      display: "inline-block",
                      width: "0.5rem",
                      height: "0.5rem",
                      borderRadius: "50%",
                      backgroundColor: "var(--color-success)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span>{dayName}</span>
              </span>
              <span style={{ color: row?.isClosed ? "var(--color-cool-steel)" : "inherit" }}>
                {timeLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Storybook stories for OperatingHours — owner: Nikao (task N4)
// Uses a static mock wrapper since the real component is a Next.js server component
// that fetches from the database.

import type { Meta, StoryObj } from "@storybook/react";

// Static mock that mirrors the real component's output without the async fetch.
// Keeps stories fast and runnable without a database connection.

interface MockHour {
  dayOfWeek: number; // 0=Sun … 6=Sat
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

interface MockOperatingHoursProps {
  hours: MockHour[];
  className?: string;
}

const DAY_NAMES: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// Static mock: pretend it is Tuesday 09:30 SAST for visual demo purposes
const MOCK_TODAY_DOW = 2; // Tuesday
const MOCK_NOW_MINUTES = 9 * 60 + 30; // 09:30

function MockOperatingHours({ hours, className }: MockOperatingHoursProps) {
  const byDay = new Map<number, MockHour>(hours.map((r) => [r.dayOfWeek, r]));

  return (
    <section
      className={className}
      aria-label="Operating hours"
      style={{ borderColor: "var(--color-porcelain-soft, #f0ece8)", maxWidth: 340 }}
    >
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {DISPLAY_ORDER.map((dow) => {
          const row = byDay.get(dow);
          const dayName = DAY_NAMES[dow] ?? String(dow);
          const isToday = dow === MOCK_TODAY_DOW;
          const openNow =
            !!row &&
            !row.isClosed &&
            row.dayOfWeek === MOCK_TODAY_DOW &&
            MOCK_NOW_MINUTES >= timeToMinutes(row.opensAt) &&
            MOCK_NOW_MINUTES < timeToMinutes(row.closesAt);

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
                borderBottom: "1px solid var(--color-porcelain-soft, #f0ece8)",
                color: isToday
                  ? "var(--color-coffee-bean, #1a0f00)"
                  : "var(--color-cool-steel, #7a8694)",
                fontWeight: isToday ? 600 : 400,
                fontFamily: "sans-serif",
                fontSize: 14,
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
                      backgroundColor: "#22c55e",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span>{dayName}</span>
              </span>
              <span
                style={{
                  color: row?.isClosed
                    ? "var(--color-cool-steel, #7a8694)"
                    : "inherit",
                }}
              >
                {timeLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const TYPICAL_HOURS: MockHour[] = [
  { dayOfWeek: 1, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 2, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 3, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 4, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 5, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 6, opensAt: "07:00", closesAt: "15:00", isClosed: false },
  { dayOfWeek: 0, opensAt: "07:00", closesAt: "13:00", isClosed: false },
];

const meta: Meta<typeof MockOperatingHours> = {
  title: "Shared/OperatingHours",
  component: MockOperatingHours,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Displays the café's Mon–Sun schedule. The green dot marks the current open slot (computed in Africa/Johannesburg timezone). Display-only — never implies orders are blocked (rule L04).",
      },
    },
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MockOperatingHours>;

export const Default: Story = {
  name: "Typical week (open Tuesday 09:30)",
  args: {
    hours: TYPICAL_HOURS,
  },
};

export const SundayClosed: Story = {
  name: "Sunday closed",
  args: {
    hours: [
      ...TYPICAL_HOURS.filter((h) => h.dayOfWeek !== 0),
      { dayOfWeek: 0, opensAt: "07:00", closesAt: "13:00", isClosed: true },
    ],
  },
};

export const EmptyData: Story = {
  name: "No hours in database (renders empty list)",
  args: {
    hours: [],
  },
};

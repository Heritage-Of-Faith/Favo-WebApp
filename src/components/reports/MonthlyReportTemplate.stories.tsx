// Storybook stories for MonthlyReportTemplate — owner: Nikao (task N10)
import type { Meta, StoryObj } from "@storybook/react";
import MonthlyReportTemplate from "./MonthlyReportTemplate";

const meta: Meta<typeof MonthlyReportTemplate> = {
  title: "Reports/MonthlyReportTemplate",
  component: MonthlyReportTemplate,
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "paper",
      values: [{ name: "paper", value: "#FBFAF6" }],
    },
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MonthlyReportTemplate>;

// ── Stories ────────────────────────────────────────────────────────────────

/** Profitable month — net positive (teal) */
export const ProfitableMonth: Story = {
  args: {
    period: "May 2026",
    // Revenue: R8,450.00
    revenue_zar: 845000,
    // COGS: R3,200.00
    cogs_zar: 320000,
    // Expenses: R1,800.00
    expenses_zar: 180000,
    // Net: R3,450.00
    net_zar: 345000,
    approvers: [
      {
        name: "Mia van Zyl",
        role: "Finance Manager",
        at: "2026-06-01T09:00:00+02:00",
      },
      {
        name: "Gian du Plessis",
        role: "Operations Lead",
        at: "2026-06-01T10:15:00+02:00",
      },
    ],
  },
};

/** Loss month — net negative (crimson) */
export const LossMonth: Story = {
  args: {
    period: "February 2026",
    // Revenue: R4,200.00
    revenue_zar: 420000,
    // COGS: R2,100.00
    cogs_zar: 210000,
    // Expenses: R2,400.00
    expenses_zar: 240000,
    // Net: −R300.00
    net_zar: -30000,
    approvers: [
      {
        name: "Mia van Zyl",
        role: "Finance Manager",
        at: "2026-03-03T08:30:00+02:00",
      },
    ],
  },
};

/** Three approvers — verifies the grid layout scales */
export const ThreeApprovers: Story = {
  args: {
    period: "April 2026",
    revenue_zar: 1020000,
    cogs_zar: 408000,
    expenses_zar: 204000,
    net_zar: 408000,
    approvers: [
      {
        name: "Mia van Zyl",
        role: "Finance Manager",
        at: "2026-05-02T09:00:00+02:00",
      },
      {
        name: "Gian du Plessis",
        role: "Operations Lead",
        at: "2026-05-02T09:45:00+02:00",
      },
      {
        name: "Nikao Titus",
        role: "Director",
        at: "2026-05-02T11:00:00+02:00",
      },
    ],
  },
};

/** Break-even month — 0 margin percentages */
export const BreakEven: Story = {
  args: {
    period: "January 2026",
    revenue_zar: 600000,
    cogs_zar: 300000,
    expenses_zar: 300000,
    net_zar: 0,
    approvers: [
      {
        name: "Mia van Zyl",
        role: "Finance Manager",
        at: "2026-02-01T10:00:00+02:00",
      },
    ],
  },
};

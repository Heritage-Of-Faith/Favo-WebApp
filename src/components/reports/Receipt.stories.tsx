// Storybook stories for Receipt — owner: Nikao (task N10)
import type { Meta, StoryObj } from "@storybook/react";
import Receipt from "./Receipt";

const meta: Meta<typeof Receipt> = {
  title: "Reports/Receipt",
  component: Receipt,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "paper",
      values: [{ name: "paper", value: "#FBFAF6" }],
    },
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Receipt>;

// ── Sample items ──────────────────────────────────────────────────────────────

const SAMPLE_ITEMS = [
  { name: "Flat White", qty: 2, unit_price_zar: 4500 },
  { name: "Avo Toast", qty: 1, unit_price_zar: 9000 },
  { name: "Sparkling Water", qty: 1, unit_price_zar: 2500 },
];

// ── Stories ────────────────────────────────────────────────────────────────

/** Partial refund — most common case */
export const PartialRefund: Story = {
  args: {
    orderId: "ORD-2026-0042",
    items: SAMPLE_ITEMS,
    // Total: R205.00
    total_zar: 20500,
    // Refund: R45.00 (one flat white)
    refund_zar: 4500,
    reason: "Item not received — Flat White out of stock",
    requested_by: "Thandeka Mokoena",
    approved_by: "Mia van Zyl",
    at: "2026-05-29T14:35:00+02:00",
  },
};

/** Full refund — entire order voided */
export const FullRefund: Story = {
  args: {
    orderId: "ORD-2026-0099",
    items: [
      { name: "Cappuccino", qty: 1, unit_price_zar: 4200 },
      { name: "Croissant", qty: 1, unit_price_zar: 3500 },
    ],
    total_zar: 7700,
    refund_zar: 7700,
    reason: "Order cancelled before preparation",
    requested_by: "Sipho Dlamini",
    approved_by: "Gian du Plessis",
    at: "2026-06-10T08:10:00+02:00",
  },
};

/** Single item — minimal receipt */
export const SingleItem: Story = {
  args: {
    orderId: "ORD-2026-0007",
    items: [{ name: "Espresso", qty: 1, unit_price_zar: 3000 }],
    total_zar: 3000,
    refund_zar: 3000,
    reason: "Wrong order placed by barista",
    requested_by: "Lerato Sithole",
    approved_by: "Mia van Zyl",
    at: "2026-04-15T11:22:00+02:00",
  },
};

/** Large order with multiple quantities */
export const LargeOrder: Story = {
  args: {
    orderId: "ORD-2026-0158",
    items: [
      { name: "Latte", qty: 4, unit_price_zar: 4500 },
      { name: "Muffin", qty: 3, unit_price_zar: 3200 },
      { name: "Orange Juice", qty: 2, unit_price_zar: 3800 },
      { name: "Eggs Benedict", qty: 1, unit_price_zar: 12500 },
    ],
    // Total: R477.00 (4×R45 + 3×R32 + 2×R38 + 1×R125)
    total_zar: 47700,
    // Refund: R9,600.00 (muffins)
    refund_zar: 9600,
    reason: "Muffins were stale — customer complaint",
    requested_by: "Nomvula Khumalo",
    approved_by: "Mia van Zyl",
    at: "2026-06-12T13:45:00+02:00",
  },
};

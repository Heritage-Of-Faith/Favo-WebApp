"use client";
// Staging-only customer resume form — owner: Nikao (task N5)
// ONLY renders when NEXT_PUBLIC_STAGING=true (Phase 1 acceptance testing).
// Lets the tester register as a known seed customer (Louis) to test push delivery.
// THIS COMPONENT MUST NOT SHIP IN PRODUCTION.

import { useState } from "react";

// Seed customer from db/seed/customers.ts — hardcoded for Phase 1 acceptance test only
const STAGING_CUSTOMERS = [
  { label: "Louis (seed customer)", id: "louis-seed-id" },
] as const;

interface StagingCustomerResumeProps {
  onCustomerSelected: (customerId: string) => void;
}

const S = {
  wrap: {
    backgroundColor: "rgba(28,5,1,0.06)",
    border: "1px dashed rgba(28,5,1,0.2)",
    borderRadius: 2,
    padding: "20px 24px",
    maxWidth: 480,
  },
  label: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-cool-steel)",
    display: "block",
    marginBottom: 12,
  },
  select: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 14,
    color: "var(--color-coffee-bean)",
    backgroundColor: "var(--color-paper)",
    border: "1.5px solid var(--color-coffee-bean)",
    borderRadius: 2,
    padding: "10px 12px",
    width: "100%",
    marginBottom: 12,
    cursor: "pointer",
  } as React.CSSProperties,
  btn: {
    display: "inline-flex",
    alignItems: "center",
    backgroundColor: "var(--color-coffee-bean)",
    color: "var(--color-porcelain)",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    border: "none",
    padding: "10px 20px",
    borderRadius: 2,
    cursor: "pointer",
  } as React.CSSProperties,
  tag: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    backgroundColor: "rgba(245,86,12,0.1)",
    padding: "3px 8px",
    borderRadius: 2,
    display: "inline-block",
    marginBottom: 12,
  } as React.CSSProperties,
} as const;

export default function StagingCustomerResume({ onCustomerSelected }: StagingCustomerResumeProps) {
  const [selected, setSelected] = useState<string>(STAGING_CUSTOMERS[0].id);

  return (
    <div style={S.wrap}>
      <span style={S.tag}>Staging only</span>
      <label style={S.label}>
        Resume as customer (Phase 1 acceptance test)
      </label>
      <select
        style={S.select}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="Select test customer"
      >
        {STAGING_CUSTOMERS.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      <button
        style={S.btn}
        onClick={() => onCustomerSelected(selected)}
      >
        Resume as this customer →
      </button>
    </div>
  );
}

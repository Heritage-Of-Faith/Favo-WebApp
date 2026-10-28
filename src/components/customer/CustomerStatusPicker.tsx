"use client";

// AT-211 / PRD §10.3 — office staff or church member, chosen by the person
// themselves at sign-up ("Set at self-registration"). Used only by the sign-up
// form; the account page does not change status.

import type { CustomerStatus } from "@/lib/customer/identity";

const OPTIONS: { value: CustomerStatus; label: string; hint: string }[] = [
  { value: "office_staff", label: "Office staff", hint: "I work in the HOFMI office" },
  { value: "church_member", label: "Church member", hint: "I'm part of the congregation" },
];

export type Props = {
  value: CustomerStatus | null;
  onChange: (value: CustomerStatus) => void;
};

export default function CustomerStatusPicker({ value, onChange }: Props) {
  const border = "color-mix(in srgb, var(--color-porcelain) 20%, transparent)";
  const selected = "var(--color-crimson-carrot)";

  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <legend className="favo-label text-cool-steel" style={{ marginBottom: 6 }}>I am</legend>
      {OPTIONS.map((o) => {
        const checked = value === o.value;
        return (
          <label
            key={o.value}
            style={{
              display: "flex", alignItems: "center", gap: 12, minHeight: 48, padding: "8px 16px",
              border: `1px solid ${checked ? selected : border}`, borderRadius: 2,
              color: "var(--color-porcelain)", cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="customer-status"
              value={o.value}
              checked={checked}
              onChange={() => onChange(o.value)}
              style={{ accentColor: selected, width: 18, height: 18 }}
            />
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 15 }}>{o.label}</span>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, opacity: 0.7 }}>{o.hint}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

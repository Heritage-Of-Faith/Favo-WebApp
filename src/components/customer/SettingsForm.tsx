"use client";

// Customer settings form — profile editing + notifications + sign-out.
// Server component (settings/page.tsx) fetches profile and passes it as props.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerProfile } from "@/server/actions/customer";
import { logoutCustomer } from "@/server/actions/customer-auth";
import NotificationToggle from "@/components/customer/NotificationToggle";

export type Props = {
  customerId: string;
  initialName: string;
  initialEmail: string | null;
  initialPhone: string | null;
  hasPushSubscription: boolean;
};

const S = {
  section: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 0,
  },
  sectionLabel: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-cool-steel)",
    marginBottom: 12,
  },
  card: {
    backgroundColor: "rgba(28,5,1,0.05)",
    border: "1px solid rgba(28,5,1,0.12)",
    borderRadius: 2,
    padding: "24px 28px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 20,
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  label: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 500,
    fontSize: 11,
    letterSpacing: "0.10em",
    textTransform: "uppercase" as const,
    color: "var(--color-cool-steel)",
  },
  input: {
    height: 48,
    backgroundColor: "var(--color-paper)",
    border: "1px solid rgba(28,5,1,0.15)",
    borderRadius: 2,
    padding: "0 16px",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 15,
    color: "var(--color-coffee-bean)",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  inputReadonly: {
    height: 48,
    backgroundColor: "rgba(28,5,1,0.03)",
    border: "1px solid rgba(28,5,1,0.08)",
    borderRadius: 2,
    padding: "0 16px",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 15,
    color: "var(--color-cool-steel)",
    width: "100%",
    boxSizing: "border-box" as const,
    display: "flex" as const,
    alignItems: "center" as const,
  },
  saveBtn: (saving: boolean) => ({
    backgroundColor: saving ? "rgba(245,86,12,0.5)" : "var(--color-crimson-carrot)",
    color: "var(--color-porcelain)",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    border: "none",
    padding: "14px 28px",
    borderRadius: 2,
    cursor: saving ? "not-allowed" : "pointer",
    alignSelf: "flex-end" as const,
    minHeight: 48,
    minWidth: 140,
  } as React.CSSProperties),
  successMsg: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
    color: "var(--color-cool-steel)",
    alignSelf: "flex-end" as const,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  errorMsg: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
    color: "var(--color-crimson-carrot)",
  },
  signOutBtn: (loading: boolean) => ({
    backgroundColor: "transparent",
    color: loading ? "rgba(28,5,1,0.3)" : "var(--color-coffee-bean)",
    border: "1px solid rgba(28,5,1,0.15)",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "14px 28px",
    borderRadius: 2,
    cursor: loading ? "not-allowed" : "pointer",
    width: "100%",
    minHeight: 48,
  } as React.CSSProperties),
} as const;

export default function SettingsForm({
  customerId,
  initialName,
  initialEmail,
  initialPhone,
  hasPushSubscription,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const patch: { name?: string; phone?: string } = {};
      if (name.trim()) patch.name = name.trim();
      if (phone.trim()) patch.phone = phone.trim();
      const res = await updateCustomerProfile(patch);
      if (!res.ok) { setSaveError(res.message); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logoutCustomer();
      router.push("/login");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>

      {/* ── Profile ─────────────────────────────────────────────────── */}
      <section style={S.section}>
        <p style={S.sectionLabel}>Profile</p>
        <div style={S.card}>
          {initialEmail && (
            <div style={S.fieldGroup}>
              <label style={S.label}>Email</label>
              <div style={S.inputReadonly} aria-label="Email address (cannot be changed here)">
                {initialEmail}
              </div>
            </div>
          )}

          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={S.fieldGroup}>
              <label htmlFor="settings-name" style={S.label}>Name</label>
              <input
                id="settings-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                style={S.input}
                onFocus={(e) => { e.target.style.borderColor = "rgba(245,86,12,0.6)"; e.target.style.outline = "2px solid rgba(245,86,12,0.3)"; e.target.style.outlineOffset = "0px"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(28,5,1,0.15)"; e.target.style.outline = "none"; }}
              />
            </div>

            <div style={S.fieldGroup}>
              <label htmlFor="settings-phone" style={S.label}>Phone</label>
              <input
                id="settings-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 082 123 4567"
                autoComplete="tel"
                style={S.input}
                onFocus={(e) => { e.target.style.borderColor = "rgba(245,86,12,0.6)"; e.target.style.outline = "2px solid rgba(245,86,12,0.3)"; e.target.style.outlineOffset = "0px"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(28,5,1,0.15)"; e.target.style.outline = "none"; }}
              />
            </div>

            {saveError && <p style={S.errorMsg}>{saveError}</p>}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 16 }}>
              {saved && (
                <span style={S.successMsg}>
                  <span style={{ color: "var(--color-crimson-carrot)" }}>✓</span> Saved
                </span>
              )}
              <button
                type="submit"
                disabled={saving}
                aria-busy={saving}
                style={S.saveBtn(saving)}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* ── Notifications ───────────────────────────────────────────── */}
      <section style={S.section}>
        <p style={S.sectionLabel}>Notifications</p>
        <NotificationToggle
          customerId={customerId}
          serverHasSubscription={hasPushSubscription}
        />
      </section>

      {/* ── Account ─────────────────────────────────────────────────── */}
      <section style={S.section}>
        <p style={S.sectionLabel}>Account</p>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          aria-busy={signingOut}
          style={S.signOutBtn(signingOut)}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </section>

    </div>
  );
}

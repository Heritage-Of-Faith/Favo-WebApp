// Staff management — owner: Mia (task A4)
// Lists staff, creates new staff, resets PINs, deactivates.
// Wired to Gian's staff Server Actions (src/server/actions/staff.ts).
"use client";

import { useCallback, useEffect, useState } from "react";
import StaffTable from "@/components/admin/StaffTable";
import StaffForm from "@/components/admin/StaffForm";
import { Button } from "@/components/ui/button";
import { listStaff } from "@/server/actions/staff";
import type { Staff } from "@/lib/types";

type FormState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "resetPin"; member: Staff };

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ mode: "closed" });

  const refresh = useCallback(async () => {
    try {
      const res = await listStaff();
      if (res.ok) setStaff(res.data);
    } catch {
      // Non-fatal — keep showing existing data on refresh failures.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-strong">Staff</h1>
          <p className="mt-1 text-sm text-text-muted">
            Manage staff members, roles, and PINs.
          </p>
        </div>
        <Button className="min-h-10" onClick={() => setForm({ mode: "create" })}>
          Add staff
        </Button>
      </header>

      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <StaffTable
          staff={staff}
          onResetPin={(member) => setForm({ mode: "resetPin", member })}
          onChanged={refresh}
        />
      )}

      {form.mode === "create" && (
        <StaffForm onClose={() => setForm({ mode: "closed" })} onSaved={refresh} />
      )}
      {form.mode === "resetPin" && (
        <StaffForm
          staffId={form.member.id}
          staffName={form.member.name}
          onClose={() => setForm({ mode: "closed" })}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

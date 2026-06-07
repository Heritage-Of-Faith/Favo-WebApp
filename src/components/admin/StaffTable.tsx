// Staff list table — owner: Mia (task A4)
// shadcn Table. Lists staff with role + status; actions: reset PIN, deactivate, reactivate.
"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { deactivateStaff, reactivateStaff } from "@/server/actions/staff";
import type { Staff } from "@/lib/types";

export type Props = {
  staff: Staff[];
  onResetPin: (member: Staff) => void;
  onChanged: () => void;
};

export default function StaffTable({ staff, onResetPin, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  async function handleDeactivate(member: Staff) {
    if (!window.confirm(`Deactivate ${member.name}? They will lose POS access immediately.`)) {
      return;
    }
    setBusy(member.id);
    try {
      const res = await deactivateStaff(member.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`${member.name} deactivated.`);
      onChanged();
    } catch {
      toast.error("Failed to deactivate staff member. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleReactivate(member: Staff) {
    setBusy(member.id);
    try {
      const res = await reactivateStaff(member.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`${member.name} reactivated.`);
      onChanged();
    } catch {
      toast.error("Failed to reactivate staff member. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (staff.length === 0) {
    return (
      <p className="rounded-md border border-border-subtle bg-elevated p-6 text-sm text-text-muted">
        No staff members yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {staff.map((member) => (
          <TableRow key={member.id}>
            <TableCell className="font-medium text-text-strong">
              {member.name}
            </TableCell>
            <TableCell className="capitalize">{member.role}</TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-1.5 favo-small">
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    display: "inline-block",
                    background: member.active
                      ? "var(--color-success)"
                      : "var(--color-text-muted)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: member.active ? "var(--color-success)" : "var(--color-text-muted)" }}>
                  {member.active ? "Active" : "Inactive"}
                </span>
              </span>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => onResetPin(member)}
                >
                  Reset PIN
                </Button>
                {member.active ? (
                  <Button
                    variant="destructive"
                    size="default"
                    disabled={busy === member.id}
                    onClick={() => handleDeactivate(member)}
                  >
                    {busy === member.id ? "Deactivating…" : "Deactivate"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="default"
                    disabled={busy === member.id}
                    onClick={() => handleReactivate(member)}
                  >
                    {busy === member.id ? "Reactivating…" : "Reactivate"}
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

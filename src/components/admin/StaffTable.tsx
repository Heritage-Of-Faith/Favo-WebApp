// Staff list table — owner: Mia (task A4)
// shadcn Table. Lists staff with role + status; actions: reset PIN, deactivate.
"use client";

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
import { deactivateStaff } from "@/server/actions/staff";
import type { Staff } from "@/lib/types";

export type Props = {
  staff: Staff[];
  onResetPin: (member: Staff) => void;
  onChanged: () => void;
};

export default function StaffTable({ staff, onResetPin, onChanged }: Props) {
  async function handleDeactivate(member: Staff) {
    const res = await deactivateStaff(member.id);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`${member.name} deactivated.`);
    onChanged();
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
              <span
                className={
                  member.active
                    ? "text-[color:var(--color-success)]"
                    : "text-text-muted"
                }
              >
                {member.active ? "Active" : "Inactive"}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  onClick={() => onResetPin(member)}
                >
                  Reset PIN
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="min-h-10"
                  disabled={!member.active}
                  onClick={() => handleDeactivate(member)}
                >
                  Deactivate
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

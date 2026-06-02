// Staff create / set-PIN form — owner: Mia (task A4)
// shadcn Dialog. PIN is set by an admin, never shown or stored in plain text.
// Create mode: name + role + PIN. Edit mode (existing staffId): reset PIN only.
"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createStaff, setStaffPin } from "@/lib/staff-placeholders";
import type { StaffRole } from "@/lib/types";

export type Props = {
  // When set, the dialog is in "reset PIN" mode for this existing staff member.
  staffId?: string;
  staffName?: string;
  onClose: () => void;
  onSaved: () => void;
};

const ROLES: StaffRole[] = [
  "barista",
  "roaster",
  "manager",
  "admin",
  "finance",
  "owner",
];

export default function StaffForm({ staffId, staffName, onClose, onSaved }: Props) {
  const isEdit = Boolean(staffId);
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("barista");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = isEdit
      ? await setStaffPin(staffId!, pin)
      : await createStaff({ name, role, pin });
    setSubmitting(false);

    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(isEdit ? "PIN updated." : `${name} added.`);
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? `Reset PIN — ${staffName ?? "staff"}` : "Add staff member"}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Enter a new 4–6 digit PIN for this staff member."
                : "Create a new staff member and set their initial PIN."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {!isEdit && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="staff-name">Name</Label>
                  <Input
                    id="staff-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Sam Barista"
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="staff-role">Role</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                    <SelectTrigger id="staff-role" className="min-h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="grid gap-2">
              <Label htmlFor="staff-pin">{isEdit ? "New PIN" : "Initial PIN"}</Label>
              <Input
                id="staff-pin"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                maxLength={6}
                placeholder="4–6 digits"
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-h-10">
              {submitting ? "Saving…" : isEdit ? "Update PIN" : "Add staff"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

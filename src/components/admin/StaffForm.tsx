// Staff create/edit form — owner: Mia (task A4)
// shadcn Dialog. PIN is set by manager, not stored in plain text.

export type Props = {
  staffId?: string;
  onClose: () => void;
};

// TODO (A4): form fields: name, role, pin (new staff only)
export default function StaffForm(_props: Props) {
  return <div>StaffForm — task A4</div>;
}

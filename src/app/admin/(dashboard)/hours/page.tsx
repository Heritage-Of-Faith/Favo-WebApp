// Operating hours editor — owner: Mia (AT-76, A14)
// Loads current hours server-side; renders HoursEditor for the week schedule.
// L04: hours are display-only — orders are never refused based on time.
import HoursEditor from "@/components/admin/HoursEditor";
import { getOperatingHours } from "@/server/actions/hours";

export const metadata = { title: "Hours" };

export default async function HoursPage() {
  const res = await getOperatingHours();
  const hours = res.ok ? res.data : [];

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="admin-page-title">Operating Hours</h1>
        <p className="mt-1 favo-small text-text-muted">
          Set the opening and closing times shown to customers. Hours are
          display-only and never block orders.
        </p>
      </header>
      <HoursEditor initialHours={hours} />
    </div>
  );
}

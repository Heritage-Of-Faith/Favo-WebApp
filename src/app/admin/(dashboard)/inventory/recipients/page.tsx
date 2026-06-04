// Low-stock alert recipients — task A12.
// Configure who receives low-stock pings, per item and globally.
// Docs: API.md, DATA_MODEL.md (stock_alert_recipients), BUSINESS_RULES.md T04.


export const metadata = { title: "Alert Recipients" };
import Link from "next/link";
import { listStockAlertRecipients } from "@/server/actions/alert-recipients";
import { listInventory } from "@/server/actions/inventory";
import { listStaff } from "@/server/actions/staff";
import RecipientsEditor from "@/components/admin/RecipientsEditor";

export default async function RecipientsPage() {
  const [recipientsRes, inventoryRes, staffRes] = await Promise.all([
    listStockAlertRecipients(),
    listInventory(),
    listStaff(),
  ]);

  const items = inventoryRes.ok ? inventoryRes.data.items.map((i) => ({ id: i.id, name: i.name })) : [];
  const staff = staffRes.ok
    ? staffRes.data.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, role: s.role }))
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <Link href="/admin/inventory" className="favo-caption" style={{ color: "var(--color-accent)" }}>
          ← Inventory
        </Link>
        <h1 className="mt-1 favo-h2" style={{ color: "var(--color-text-strong)" }}>
          Low-stock recipients
        </h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Tick a cell to notify a staff member when stock runs low. Global recipients get every alert.
        </p>
      </header>

      {recipientsRes.ok ? (
        <RecipientsEditor items={items} staff={staff} initialRecipients={recipientsRes.data.recipients} />
      ) : (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {recipientsRes.message}
        </p>
      )}
    </div>
  );
}

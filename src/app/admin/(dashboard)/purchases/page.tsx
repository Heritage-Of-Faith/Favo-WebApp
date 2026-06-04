// Purchases — task A10 (L10).
// Record purchases (creating lots) and approve pending emergency purchases.
// Docs: API.md, BUSINESS_RULES.md L10.


export const metadata = { title: "Purchases" };
import { getSession } from "@/lib/auth/session";
import { listPurchases } from "@/server/actions/purchases";
import { listInventory } from "@/server/actions/inventory";
import PurchasesManager from "@/components/admin/PurchasesManager";

export default async function PurchasesPage() {
  const session = await getSession();
  const canApprove = session?.role === "admin" || session?.role === "owner";

  const [purchasesRes, inventoryRes] = await Promise.all([listPurchases(), listInventory()]);
  const items = inventoryRes.ok
    ? inventoryRes.data.items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="favo-h2" style={{ color: "var(--color-text-strong)" }}>
          Purchases
        </h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Recording a purchase creates inventory lots. Emergency purchases need admin sign-off (L10).
        </p>
      </header>

      {purchasesRes.ok ? (
        <PurchasesManager initialPurchases={purchasesRes.data.purchases} items={items} canApprove={canApprove} />
      ) : (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {purchasesRes.message}
        </p>
      )}
    </div>
  );
}

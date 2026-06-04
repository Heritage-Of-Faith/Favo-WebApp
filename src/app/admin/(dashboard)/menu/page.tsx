// Menu management — owner: Mia (task A5)
// Price edits call setMenuItemPrice → price_history row (rule, docs/API.md).
// Wired to Gian's menu Server Actions (src/server/actions/menu.ts).


export const metadata = { title: "Menu" };
import MenuEditor from "@/components/admin/MenuEditor";

export default function MenuPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-strong">Menu</h1>
        <p className="mt-1 text-sm text-text-muted">
          Edit item prices. Each change is recorded in the price history.
        </p>
      </header>
      <MenuEditor />
    </div>
  );
}

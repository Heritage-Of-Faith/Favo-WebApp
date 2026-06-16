// Customer menu page — owner: Nikao (task N11 — AT-55)
// SSR, no auth required. Works without JavaScript.
// Calls getPublicMenu() which applies live stock availability rules.

import { getPublicMenu } from "@/server/actions/public";
import { formatZar } from "@/lib/format";
import type { MenuCategory } from "@/lib/types";

export const metadata = {
  title: "Menu — FAVO Café",
  description: "Our current menu and today's availability.",
};

const CATEGORY_LABELS: Record<MenuCategory, string> = {
  coffee: "Coffee",
  tea: "Tea",
  cold_brew: "Cold Brew",
  food: "Food",
  merchandise: "Merchandise",
  other: "Other",
};

const CATEGORY_ORDER: MenuCategory[] = [
  "coffee",
  "cold_brew",
  "tea",
  "food",
  "merchandise",
  "other",
];

export default async function MenuPage() {
  const result = await getPublicMenu();

  if (!result.ok) {
    return (
      <main
        style={{
          minHeight: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-paper)",
          fontFamily: "var(--font-sans)",
          color: "var(--color-coffee-bean)",
        }}
      >
        <p>Could not load the menu right now. Please ask a barista.</p>
      </main>
    );
  }

  const items = result.data;

  const byCategory = new Map<MenuCategory, typeof items>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  const presentCategories = CATEGORY_ORDER.filter((c) => byCategory.has(c));

  return (
    <main
      style={{
        minHeight: "100svh",
        background: "var(--color-paper)",
        fontFamily: "var(--font-sans)",
        color: "var(--color-coffee-bean)",
      }}
    >
      {/* ── Page header ── */}
      <header
        style={{
          borderBottom: "3px solid var(--color-coffee-bean)",
          padding: "24px 20px 20px",
          maxWidth: "600px",
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 900,
            fontSize: "2rem",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            margin: "0 0 4px",
          }}
        >
          FAVO Café
        </h1>
        <p
          style={{
            fontSize: "var(--text-small)",
            color: "var(--color-text-muted)",
            margin: 0,
          }}
        >
          Menu
        </p>
      </header>

      {/* ── Category sections ── */}
      <div
        style={{
          maxWidth: "600px",
          margin: "0 auto",
          padding: "0 20px 40px",
        }}
      >
        {presentCategories.map((category) => {
          const sectionItems = byCategory.get(category) ?? [];
          return (
            <section key={category} aria-labelledby={`cat-${category}`}>
              <h2
                id={`cat-${category}`}
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: "var(--text-sub)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--color-coffee-bean)",
                  margin: "28px 0 8px",
                  paddingBottom: "6px",
                  borderBottom: "1px solid var(--color-border-subtle)",
                }}
              >
                {CATEGORY_LABELS[category]}
              </h2>

              <ul
                role="list"
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                }}
              >
                {sectionItems.map((item) => (
                  <li
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "14px 0",
                      borderBottom: "1px solid var(--color-border-subtle)",
                      gap: "12px",
                      opacity: item.available ? 1 : 0.55,
                    }}
                  >
                    {/* Name + badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: "var(--text-base)",
                          fontWeight: item.available ? 400 : 400,
                          color: "var(--color-coffee-bean)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.name}
                      </span>

                      {!item.available && item.unavailableLabel && (
                        <span
                          role="status"
                          aria-label={item.unavailableLabel}
                          style={{
                            fontFamily: "var(--font-sans)",
                            fontSize: "var(--text-caption)",
                            fontWeight: 600,
                            letterSpacing: "0.04em",
                            color: "var(--color-text-muted)",
                            background: "var(--color-porcelain-soft)",
                            borderRadius: "var(--radius-pill)",
                            padding: "2px 8px",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {item.unavailableLabel}
                        </span>
                      )}
                    </div>

                    {/* Price */}
                    <span
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "var(--text-base)",
                        fontVariantNumeric: "tabular-nums",
                        color: item.available
                          ? "var(--color-coffee-bean)"
                          : "var(--color-text-muted)",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {formatZar(item.currentPriceZar)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* ── Footer note ── */}
      <footer
        style={{
          maxWidth: "600px",
          margin: "0 auto",
          padding: "0 20px 32px",
        }}
      >
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-text-faint)",
            textAlign: "center",
          }}
        >
          Prices include VAT · Menu subject to change
        </p>
      </footer>
    </main>
  );
}

// Pure menu-availability logic, split out of the `"use server"` action module
// so it can stay a synchronous, unit-testable export. (Files with the
// "use server" directive may only export async Server Actions.)

/**
 * Determine if a menu item is available based on ingredient stock.
 *
 * An item is available when ALL of its required ingredients have a net
 * stock total > 0 (SUM of stock_movements.delta across ALL lots).
 * If the item has no recipe (tea, food), it is always considered available.
 *
 * This function is pure / injectable so it can be unit-tested without a DB.
 *
 * @param ingredientStocks  Map of inventoryItemId => net stock (integer base units).
 *                          If an inventoryItemId is absent, it is treated as 0.
 * @param requiredIngredientIds  The inventory item IDs the recipe needs.
 *                               Empty array means no dependencies, so available.
 */
export function computeItemAvailability(
  ingredientStocks: Map<string, number>,
  requiredIngredientIds: string[]
): boolean {
  if (requiredIngredientIds.length === 0) return true;
  return requiredIngredientIds.every(
    (id) => (ingredientStocks.get(id) ?? 0) > 0
  );
}

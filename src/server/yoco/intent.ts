// Yoco payment intent helpers — task G6

export async function createOrderIntent(
  _orderId: string,
  _amountZar: number
): Promise<{ clientSecret: string; intentId: string }> {
  throw new Error("Not implemented — see task G6");
}

// TODO (G7): Send Web Push notification to a customer when order is 'ready'
// Triggered by transitionOrder → ready (docs/API.md)

export async function sendOrderReadyPush(
  _customerId: string,
  _orderId: string
): Promise<void> {
  throw new Error("Not implemented — see task G7");
}

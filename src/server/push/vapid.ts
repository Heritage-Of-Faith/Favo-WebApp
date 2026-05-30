// VAPID configuration for Web Push — task G7
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (+ NEXT_PUBLIC_VAPID_PUBLIC_KEY for the client).

import webpush from "web-push";

const VAPID_SUBJECT = "mailto:ops@hofmi.org";
let configured = false;

/** Configure web-push with the VAPID key pair. Idempotent. Throws if unset. */
export function initVapid(): void {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).");
  }
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
  configured = true;
}

/** Public key the client needs to create a subscription. */
export function getVapidPublicKey(): string {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY;
  if (!key) throw new Error("VAPID public key is not configured.");
  return key;
}

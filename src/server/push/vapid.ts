// VAPID configuration for Web Push — task G7
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (+ NEXT_PUBLIC_VAPID_PUBLIC_KEY for the client).

import webpush from "web-push";

// The VAPID "subject" is only a contact the push services can use; users never see it.
// It used to be a mailto: on hofmi.org, a domain that never existed (PRD v7 §9.3). The public
// URL is a valid subject and needs no mailbox; set VAPID_SUBJECT (https: or mailto:) to override.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT?.trim() || "https://favo.hofmi.net";
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

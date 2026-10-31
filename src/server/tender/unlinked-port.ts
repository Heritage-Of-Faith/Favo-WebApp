// AT-201 part 2b: the Web POS port FAVO runs with until the live HTTP adapter
// exists (it is built and proven at gate zero, §6.8.2 — never against live
// Yoco from here). It reports that no Web POS device is linked: every send is
// a device error (TERMINAL_UNREACHABLE — S1: "No Web POS device is linked") and
// every fetch is a fetch error, which is never a status (§6.8.4). Nothing can
// be charged through it.

import type { YocoWebPosPort } from "@/server/yoco/webpos-port";

export const unlinkedWebPosPort: YocoWebPosPort = {
  async lookupDevice() {
    return { kind: "device_error" };
  },
  async sendPayment() {
    return { kind: "device_error" };
  },
  async fetchPayment() {
    return { kind: "fetch_error" };
  },
  async findPaymentsByClientReference() {
    return { kind: "fetch_error" };
  },
};

// AT-201: the live Web POS adapter is OFF unless explicitly switched on.
// Until Nikao runs §6.8.2's R1.00 test, every environment keeps the unlinked
// port: nothing can be sent to a card machine.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: vi.fn(async () => {}) }));

import { selectWebPosPort, unlinkedWebPosPort } from "@/server/tender/runtime";

describe("selectWebPosPort", () => {
  it("no switch → the unlinked port, even with a key set", () => {
    expect(selectWebPosPort({})).toBe(unlinkedWebPosPort);
    expect(selectWebPosPort({ YOCO_SECRET_KEY: "sk_test_x" })).toBe(unlinkedWebPosPort);
  });

  it("the switch with no key → the unlinked port", () => {
    expect(selectWebPosPort({ YOCO_WEBPOS_LIVE: "1" })).toBe(unlinkedWebPosPort);
    expect(selectWebPosPort({ YOCO_WEBPOS_LIVE: "1", YOCO_SECRET_KEY: "" })).toBe(unlinkedWebPosPort);
  });

  it("only the literal value 1 switches it on", () => {
    for (const v of ["true", "yes", "0", " 1"]) {
      expect(selectWebPosPort({ YOCO_WEBPOS_LIVE: v, YOCO_SECRET_KEY: "sk_test_x" })).toBe(unlinkedWebPosPort);
    }
  });

  it("switch AND key → the live adapter (constructing it makes no request)", () => {
    const port = selectWebPosPort({ YOCO_WEBPOS_LIVE: "1", YOCO_SECRET_KEY: "sk_test_x" });
    expect(port).not.toBe(unlinkedWebPosPort);
    expect(typeof port.sendPayment).toBe("function");
  });
});

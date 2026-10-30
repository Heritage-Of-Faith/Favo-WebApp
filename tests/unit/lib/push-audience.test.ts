// REQ-056 — audience is derived from the mode.
import { describe, it, expect } from "vitest";
import { audienceForMode } from "@/lib/push/audience";

describe("audienceForMode", () => {
  it("weekday reaches office staff only", () => {
    expect(audienceForMode("weekday")).toEqual(["office_staff"]);
  });
  it("sunday reaches office staff and church members", () => {
    expect(audienceForMode("sunday").sort()).toEqual(["church_member", "office_staff"]);
  });
  it("event reaches the profile's audience", () => {
    expect(audienceForMode("event", ["church_member"])).toEqual(["church_member"]);
  });
  it("event with no profile audience reaches nobody (fail closed)", () => {
    expect(audienceForMode("event")).toEqual([]);
  });
});

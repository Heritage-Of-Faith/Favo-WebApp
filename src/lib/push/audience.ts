// REQ-056 / §6.3 — the opening-window audience is DERIVED from the session
// mode, never assembled by hand. Weekday: office staff. Sunday: office staff +
// church members. Event: whatever the event profile specifies.
//
// No event profile exists in the schema yet, so an event with no profile
// audience reaches NOBODY (fail closed) rather than everybody.

import type { SessionMode } from "@/lib/session-mode";

export type CustomerStatus = "office_staff" | "church_member";

export function audienceForMode(
  mode: SessionMode,
  eventProfileAudience: readonly CustomerStatus[] = []
): CustomerStatus[] {
  switch (mode) {
    case "weekday":
      return ["office_staff"];
    case "sunday":
      return ["office_staff", "church_member"];
    case "event":
      return [...eventProfileAudience];
  }
}

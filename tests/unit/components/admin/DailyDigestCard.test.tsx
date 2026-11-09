// DEC-23 / §9.6.3: the digest card. What FAVO cannot measure yet (storage,
// queue-stream disconnects) reads "not measured yet", never zero.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatZar } from "@/lib/format";
import DailyDigestCard from "@/components/admin/DailyDigestCard";
import DormancyBanner from "@/components/admin/DormancyBanner";
import { voucherDigest, type AdminDigest } from "@/server/alerts/daily-digest";

function digest(over: Partial<AdminDigest> = {}): AdminDigest {
  return {
    day: "2026-11-08",
    vouchers: voucherDigest([{ opensAt: "18:30", recorded: 26, slipsCounted: 26, liveZar: 52_000 }], 25),
    fundLiabilityZar: 500_001,
    fundLiabilityAboveLine: true,
    activeFundCount: 4,
    lastClose: { revenueDay: "2026-11-08", reconciliationStatus: "payments_matched", blockedReason: null, writtenOffCount: 0, writtenOffZar: 0, wasCatchUp: false },
    yesterdayUnclosed: false,
    ...over,
  };
}

describe("DailyDigestCard", () => {
  it("storage and queue-stream disconnects read 'not measured yet', never 0", () => {
    render(<DailyDigestCard digest={digest()} />);
    expect(screen.getByTestId("digest-storage").textContent).toContain("not measured yet");
    expect(screen.getByTestId("digest-stream").textContent).toContain("not measured yet");
    expect(screen.getByTestId("digest-storage").textContent).not.toMatch(/\d/);
    expect(screen.getByTestId("digest-stream").textContent).not.toMatch(/\d/);
  });

  it("names the T11 crossing and the fund line", () => {
    render(<DailyDigestCard digest={digest()} />);
    expect(screen.getByTestId("digest-vouchers").textContent).toContain("above the expected 25 per session");
    expect(screen.getByTestId("digest-funds").textContent).toContain(`above the ${formatZar(500_000)} line`);
  });

  it("an unclosed yesterday is said so", () => {
    render(
      <DailyDigestCard
        digest={digest({ lastClose: { revenueDay: "2026-11-06", reconciliationStatus: "blocked", blockedReason: "variance", writtenOffCount: 0, writtenOffZar: 0, wasCatchUp: false }, yesterdayUnclosed: true })}
      />
    );
    expect(screen.getByTestId("digest-close").textContent).toContain("2026-11-06: blocked — variance");
    expect(screen.getByTestId("digest-close").textContent).toContain("2026-11-08 is not closed yet.");
  });
});

describe("DormancyBanner", () => {
  it("renders nothing when no fund is past T14 − 30 days", () => {
    const { container } = render(<DormancyBanner items={[]} />);
    expect(container.textContent).toBe("");
  });

  it("names each fund and its stage", () => {
    render(
      <DormancyBanner
        items={[
          { code: "FVO-AAAA", displayName: "Louis M.", stage: "dormant", idleDays: 180, balanceZar: 25_000 },
          { code: "FVO-BBBB", displayName: null, stage: "alert", idleDays: 150, balanceZar: 10_000 },
        ]}
      />
    );
    const text = screen.getByTestId("dormancy-banner").textContent ?? "";
    expect(text).toContain("Louis M. (FVO-AAAA)");
    expect(text).toContain("no movement for 180 days — dormant: proposed for sweep (an Admin decides)");
    expect(text).toContain("FVO-BBBB (FVO-BBBB)");
    expect(text).toContain("no movement for 150 days — ask the donor");
  });

  it("an invalid T14 says dormancy cannot be checked", () => {
    render(<DormancyBanner items={null} />);
    expect(screen.getByRole("status").textContent).toContain("can't be checked");
  });
});

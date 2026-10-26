// §6.1 / dependency table: Web Push — 3 attempts, exponential backoff.
// 404/410 is terminal (caller prunes). Other errors retry, then give up
// WITHOUT throwing into the order transition.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: { sendNotification: (...a: unknown[]) => sendNotification(...a), setVapidDetails: vi.fn() },
}));
vi.mock("@/server/push/vapid", () => ({ initVapid: vi.fn() }));

import {
  sendOrderReadyPush,
  sendHoursPostedPush,
  sendOpeningPush,
  PUSH_MAX_ATTEMPTS,
  PUSH_BACKOFF_BASE_MS,
} from "@/server/push/send";

const SUB = { endpoint: "https://push.invalid/x", keys: { p256dh: "a", auth: "b" } };

beforeEach(() => {
  vi.useFakeTimers();
  sendNotification.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("push retry", () => {
  it("uses 3 attempts and a 500 ms base", () => {
    expect(PUSH_MAX_ATTEMPTS).toBe(3);
    expect(PUSH_BACKOFF_BASE_MS).toBe(500);
  });

  it("succeeds first time with a single send", async () => {
    sendNotification.mockResolvedValue({});
    await expect(sendOrderReadyPush(SUB, "o1", "Sam")).resolves.toBe(true);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure with exponential backoff, then succeeds", async () => {
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 503 }))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({});
    const p = sendOrderReadyPush(SUB, "o1");
    await vi.advanceTimersByTimeAsync(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(sendNotification).toHaveBeenCalledTimes(1); // still waiting 500 ms
    await vi.advanceTimersByTimeAsync(1);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(sendNotification).toHaveBeenCalledTimes(2); // second wait is 1000 ms
    await vi.advanceTimersByTimeAsync(1);
    expect(sendNotification).toHaveBeenCalledTimes(3);
    await expect(p).resolves.toBe(true);
  });

  it("gives up after 3 attempts WITHOUT throwing, and does not report the subscription dead", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("down"), { statusCode: 500 }));
    const p = sendOrderReadyPush(SUB, "o1");
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe(true);
    expect(sendNotification).toHaveBeenCalledTimes(3);
  });

  it.each([404, 410])("treats %i as terminal: one attempt, returns false (caller prunes)", async (code) => {
    sendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: code }));
    const p = sendOrderReadyPush(SUB, "o1");
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe(false);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("applies the same policy to the hours and opening pushes", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    await expect(sendHoursPostedPush(SUB, "08:00", "16:00", false)).resolves.toBe(false);
    await expect(sendOpeningPush(SUB, "08:00", false)).resolves.toBe(false);
    expect(sendNotification).toHaveBeenCalledTimes(2);

    sendNotification.mockReset();
    sendNotification.mockRejectedValue(new Error("down"));
    const a = sendHoursPostedPush(SUB, "08:00", "16:00", false);
    const b = sendOpeningPush(SUB, "08:00", false);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    expect(sendNotification).toHaveBeenCalledTimes(6);
  });

  it("puts the hours-posted url under data, where public/sw.js reads it", async () => {
    sendNotification.mockResolvedValue({});
    await sendHoursPostedPush(SUB, "08:00", "16:00", false);
    const body = JSON.parse(sendNotification.mock.calls[0]![1] as string);
    expect(body.data).toEqual({ url: "/customer" });
    expect(body.url).toBeUndefined();
  });
});

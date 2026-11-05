# Deferred: decided to do later, must not be forgotten

Each item names who decided, when, what is skipped, where the switch is, and when it comes back.

| Item | Decided | What is skipped | Switch | Comes back when |
|---|---|---|---|---|
| **Sunday card sales in FAVO** | Nikao, Slack, 3 Nov 2026 10:46: "You can skip Sunday card sales FOR NOW. But it is important that you make a note of this that we do install it later." | Sunday card sales stay on the physical Yoco machine. The nightly close does not write off a Sunday order with nothing sent to the terminal, and leaves those orders out of its card reconciliation. | `SUNDAY_ORDERS_NEVER_SWEPT_UNTIL_WEBPOS_LIVE` in `src/server/close/write-offs.ts` (now `true`) | The live Yoco Web POS adapter (`YocoWebPosPort`, AT-201 remainder) is built and drilled. Close every earlier Sunday **before** flipping the flag: a catch-up close of an older Sunday after the flip would write its machine takings off. Steps: `docs/GO_LIVE_RUNBOOK.md` section 9. |

# FAVO POS Rebuild — Phase 1: Research

**Status:** Approved (2026-07-05) · **Phase 1 of 6** in the POS rebuild (research → Jira audit → strategy → flow design → wireframe → build)

Full interactive version (citations, layout): see the Phase 1 artifact from the 2026-07-05 planning session.

## Why this exists

The current POS has five known problems:
1. No points-redemption function.
2. The wallet was built as a place to load money onto an account, not a display of points-as-money.
3. Cluttered layout.
4. Broken/overlapping interactivity.
5. A filter column that doesn't scale with the item catalog.

Five agents researched in parallel — one per angle below — each required to cite 6+ sources from a strict authority bar (Apple Human Interface Guidelines, W3C/WCAG, Nielsen Norman Group, Baymard Institute, peer-reviewed HCI journals/conferences — no blogs, Reddit, or Wikipedia). 40 citations were collected, 36 unique after de-duplication.

## A — Layout patterns (answers: cluttered layout)

- iPad's native navigation pattern is a **split view**, not a tab bar — persistent nav pane (~1/3) + content pane (~2/3), not phone-style single-pane navigation. *(Apple HIG, "Split Views")*
- The active selection must stay visibly synced between panes to avoid disorientation. *(Apple HIG, "Adaptivity and Layout")*
- More screen space needs deliberate placement, not just bigger buttons (Fitts's Law). *(NN/g "Very Large Touchscreen UX Design"; Fitts 1954)*
- Flat, uncategorized grids slow decisions down (Hick's Law). *(NN/g, "Hick's Law")*
- The order summary needs a fixed, dedicated, non-collapsible region — never a drawer or modal. *(Baymard, "Cart & Checkout Usability Research")*

**Recommendation:** persistent nav pane + content pane spine; a fixed, always-visible order region; category-filtered grids over one flat list — **superseded by the menu-trim decision below** (see amendments).

## B — Touch targets & ergonomics (answers: broken interactivity)

- 44×44pt is Apple's floor for any tappable control; WCAG 2.5.8 sets a legal minimum of 24×24 CSS px (or non-intersecting 24px hit-circles), 44×44 is the AAA enhanced target. *(Apple HIG "Layout"; WCAG 2.2 §2.5.8; WCAG 2.1 §2.5.5)*
- Accuracy drops sharply under ~1cm² target size. *(Parhi, Karlson & Bederson 2006, MobileHCI; MIT Touch Lab)*
- Overlapping tap zones are a formally testable bug class (WCAG's non-intersecting hit-circle test). *(WCAG 2.2, Understanding SC 2.5.8)*
- Reachability isn't uniform: ~96% accuracy in the natural thumb zone vs. ~61% in the stretch zone, ~2.7× faster. *(NN/g thumb-zone research; Hoober 2013)*

**Recommendation:** hard 44×44pt floor with 8–12pt gaps everywhere; wider gaps around checkout/void/discount; high-frequency/high-cost actions in the reachable zone; automated hit-circle overlap check as a regression gate.

## C — Ordering flow (answers: cluttered layout / broken interactivity)

- Recognition beats recall — cart and modifiers stay visible, staff shouldn't have to remember state. *(NN/g, "10 Usability Heuristics")*
- Editing an order must never mean restarting it — an always-available undo/cancel without losing data. *(NN/g, "User Control and Freedom")*
- Menu/UI design was the strongest predictor of satisfaction (β=0.378, p<.001) in a peer-reviewed 225-user QSR kiosk study; a persistent visual order recap lets customers catch mistakes before they're locked in. *(Shahril et al. 2021, IJARBSS)*
- Speed is the #1 reason (77%) customers prefer a faster checkout path. *(NCR Voyix, Commerce Experience Report)*

**Recommendation:** persistent order summary across browse→modify→pay; ~~a "favorites/most-ordered" default landing shelf~~ **dropped, see amendments**; two-tier confirmation (destructive = confirm, everything else = instantly undoable); decouple order-building from payment so staff can keep editing mid-checkout.

## D — Loyalty & redemption (answers: missing redemption / misimplemented wallet)

- Points shown only as an abstract count under-trigger the engagement loss-aversion drives once a balance is perceived as "theirs." *(Baymard, "Loyalty Program UX")*
- Easy redemption is the single largest driver of perceived loyalty-program value — ranked above reward variety or earn rate. *(Smith & Sparks 2009, Journal of Business Research)*
- Points are a real financial liability (Delta: $3.9B, Marriott: $2.6B outstanding) — argues for a hard, system-enforced redemption cap, not staff judgment. *(Chun & Iancu, Stanford GSB/MIT Sloan working paper)*
- Totals must recalculate live, before commit, so the operator can visually catch an error. *(Stripe, "Checkout UI design strategies")*

**Recommendation:** currency-first balance display ("Loyalty balance: R24.00 (240 pts)" — see naming decision below); single-tap redemption defaulting to max eligible, hard-capped at order total; live total recalculation; every redemption logged against its transaction.

## E — Browsing vs. filter columns (answers: filter column doesn't scale) — **deferred, then dropped**

- Filter lists fail once unprioritized/too long, not at a fixed count — Baymard recommends 5–10 prioritized attributes, not exposing everything flat. *(Baymard, "Ecommerce Filter UI Best Practices")*
- >50% of users are search-dominant as catalogs grow, but search alone fails users unfamiliar with the catalog's vocabulary — browse and search are complementary. *(NN/g, "Search Is Not Enough")*
- Broad-and-shallow beats narrow-and-deep for finding a known item on touch. *(arXiv:2404.11469, in-vehicle touchscreen menu study)*
- Apple's own iPad guidance shifts from tab bars to a sidebar once item counts get large — but always paired with search. *(Apple HIG, "Navigation and Search"; "Tab Bars")*

**Applicability at current scale:** these recommendations are conditioned in the cited research on catalogs of ~15–20+ items. **Superseded entirely** — see amendments below.

## F — The Favo (new feature, product decision, not literature-sourced)

- One saved usual/regular order per customer, tied to their name (naming plays off "FAVO").
- Two edit entry points, same underlying record: the customer sets it from their loyalty page; a barista can also set/edit it from the POS.
- At checkout, once a known customer is attached, "reorder their Favo" is a one-tap shortcut inside the normal order-building step.
- Deliberately a secondary/tucked-away POS surface (e.g. inside the customer's profile card) — not a primary, always-on feature.
- Distinct from a shop-wide "most ordered" shelf: Favo is personal, not popularity-driven, so it doesn't reintroduce any reordering/muscle-memory problem.

## Amendments (post-review, 2026-07-05)

1. **Menu confirmed: trimming from 14 items/4 categories → 5 signature items.** Sections E's search/category work and Section C's dynamic favorites shelf are both **dropped, not just deferred** — a fixed grid of 5 items in the same position every time beats any dynamic or categorized navigation at this scale. Revisit only if the menu later grows past ~15–20 items, and even then prefer a barista-pinned layout over an auto-sorted one.
2. **Stored-value wallet removed entirely** (see Phase 2 doc for full scope). The word "wallet" is retired everywhere; the only money-value display going forward is the loyalty points balance, labeled **"Loyalty balance."**

## Sources

36 unique sources across Apple HIG, W3C/WCAG, Baymard Institute, Nielsen Norman Group, and peer-reviewed HCI journals/conferences (Fitts 1954; Parhi/Karlson/Bederson 2006; Shahril et al. 2021; Smith & Sparks 2009; Li/Swaminathan/Kim 2025; Chun & Iancu; Matsui et al. arXiv:2509.14508; arXiv:2404.11469; Oxford Academic *Interacting with Computers*). Full citation list is in the interactive Phase 1 artifact.

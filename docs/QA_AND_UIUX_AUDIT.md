# FAVO Café — QA & UI/UX Audit Guide

> **Purpose:** Complete feature verification + design polish pass before stakeholder feedback.
> **Base URL:** https://favo.hofmi.org (production) or `bun dev` → http://localhost:3000
> **Prerequisite:** All Wave 3 PRs (#177–#181) merged to main and deployed.

---

## Test Accounts

| Role | How to log in | Credentials |
|------|--------------|-------------|
| Barista | `/staff/login` → PIN keypad | `1234` |
| Admin | `/staff/login` → PIN keypad | Check `db/seed/staff.ts` for admin PIN |
| Customer | `/login` → email + password | Sign up fresh, or use seeded "Louis" account |

---

## Merge checklist (do first if not done)

```bash
# Verify all PRs are green then merge in this order:
gh pr merge 178 --squash --delete-branch   # AT-126 docs (no schema)
gh pr merge 177 --squash --delete-branch   # AT-123 loyalty adjustment (adds migration)
gh pr merge 179 --squash --delete-branch   # AT-127 liability report
gh pr merge 180 --squash --delete-branch   # AT-124 reconciliation
gh pr merge 181 --squash --delete-branch   # AT-128 customer loyalty history
```

---

## Surface 1 — Landing Page (`/`)

### Functional
- [ ] Page loads with correct hero copy and FAVO branding
- [ ] NumbersStrip figures are accurate (not placeholders)
- [ ] TeamStrip photos all load
- [ ] "View menu" / any CTAs navigate correctly
- [ ] Footer links work

### UI/UX
- [ ] Mobile viewport (375px) — no horizontal scroll, text readable
- [ ] Hero image loads quickly, no layout shift (CLS)
- [ ] Spacing between sections feels consistent
- [ ] Fonts render correctly (no FOUT)

---

## Surface 2 — Public Menu (`/menu`)

### Functional
- [ ] All menu categories render
- [ ] Item names, prices formatted correctly (R format)
- [ ] SSR — page works with JS disabled (View Source, confirm content is there)
- [ ] Out-of-stock items shown correctly (badge or hidden)

### UI/UX
- [ ] Category headers visually distinct
- [ ] Price alignment consistent
- [ ] Mobile: items stack cleanly, no overlap

---

## Surface 3 — Customer Auth (`/login`, `/signup`)

### Functional
- [ ] Sign up → receives confirmation email
- [ ] Sign in with correct credentials → lands on `/customer`
- [ ] Sign in with wrong password → clear error message
- [ ] Forgot password / reset flow works (Supabase email link → `/reset-password`)

### UI/UX
- [ ] Form labels and placeholders correct
- [ ] Error states styled clearly (red, not just console)
- [ ] Loading state on submit button (no double-click)
- [ ] Dark/light mode consistency

---

## Surface 4 — Customer Dashboard (`/customer`)

### Functional
- [ ] Loyalty balance matches `customers.loyalty_points` in DB
- [ ] Wallet balance matches `customers.wallet_zar` / 100 (ZAR)
- [ ] Active packs show correct count
- [ ] Order history list shows recent orders
- [ ] WelcomeModal appears on first login, not again after dismissed

### UI/UX
- [ ] Cards align cleanly in grid
- [ ] Loyalty/Wallet/Packs cards are visually clear
- [ ] Back navigation from sub-pages works
- [ ] Loading skeleton or spinner while data fetches

---

## Surface 5 — Customer Wallet (`/wallet`)

### Functional
- [ ] Balance shown in ZAR (formatZar)
- [ ] Transaction history shows kind (topup/spend/refund/adjustment)
- [ ] Delta shows correctly (+/−)
- [ ] Pagination works if > 20 transactions
- [ ] Empty state if no transactions

### UI/UX
- [ ] Kind labels are readable and colour-coded
- [ ] Amounts right-aligned
- [ ] Date format consistent (Africa/Johannesburg timezone)

---

## Surface 6 — Customer Packs (`/packs`)

### Functional
- [ ] Active packs shown with expiry date
- [ ] Expired packs in collapsible section
- [ ] Correct qty remaining shown per pack
- [ ] Pack menu item name shown

### UI/UX
- [ ] Expiry urgency communicated (near expiry = different colour?)
- [ ] Empty state: clear message if no packs
- [ ] PackDetailCard looks polished

---

## Surface 7 — Customer Loyalty History (`/loyalty`) ← **NEW AT-128**

### Functional
- [ ] Page loads (route: `/loyalty`, not `/account/loyalty`)
- [ ] Current balance shown prominently
- [ ] "Earn 5 pts per R10. Redeem 100 pts = R20 off." line visible
- [ ] Transaction rows show: kind badge, delta (+/−), running balance, date
- [ ] Kind badges colour-coded: earn=teal, redeem=orange, adjustment=steel, expiry=red
- [ ] Pagination: prev/next via `?page=N`
- [ ] Empty state if no transactions
- [ ] Redirect to `/login` if not signed in

### UI/UX
- [ ] Dark `var(--color-coffee-bean)` background matches wallet/packs pages
- [ ] FAVO wordmark + "← Back" nav consistent with wallet/packs
- [ ] Running balance column clearly labelled
- [ ] Badge colours distinct and readable on dark bg

---

## Surface 8 — Customer Settings (`/customer/settings`)

### Functional
- [ ] Profile name/email editable and saves
- [ ] Push notification toggle works (check browser permission prompt)
- [ ] Sign out → lands at `/login` or `/`

### UI/UX
- [ ] Form fields sized correctly
- [ ] Success/error toast on save

---

## Surface 9 — POS Login (`/staff/login`)

### Functional
- [ ] PIN keypad renders and accepts input
- [ ] Correct PIN (1234) → redirects to `/pos/queue`
- [ ] Admin PIN → redirects to `/admin`
- [ ] Wrong PIN → clear error, no redirect
- [ ] Back/clear button works on keypad

### UI/UX
- [ ] Keypad is touch-friendly (large tap targets)
- [ ] Dark background (coffee-bean) consistent
- [ ] FAVO branding visible

---

## Surface 10 — POS Queue (`/pos/queue`)

### Functional
- [ ] Live queue board loads (SSE connected)
- [ ] Customer search by name and phone works
- [ ] Selecting a customer shows CustomerCard
- [ ] Menu items can be added to order
- [ ] Quantities increment/decrement correctly
- [ ] Order total computed correctly
- [ ] Connectivity pill shows green/red status
- [ ] Offline mode: queue persists, sync drawer appears on reconnect

### New loyalty features to verify:
- [ ] **WalletSpendDialog** opens when customer has wallet balance; applies spend, order total updates
- [ ] **PackRedeemSection** shows "Use pack" button only for coffee items; applies correctly
- [ ] **LoyaltyRedeemStepper** allows point redemption (100 pts = R20); order total updates

### UI/UX
- [ ] OrderBuilder scrolls independently from queue board
- [ ] Active customer clearly highlighted
- [ ] Order total in large, readable format
- [ ] CTA buttons sized for touch
- [ ] Queue board updates in real-time without full page reload

---

## Surface 11 — POS Order Detail (`/pos/order/[id]`)

### Functional
- [ ] Order items and total shown correctly
- [ ] "Mark complete" (Done) button visible and dominant
- [ ] Status transitions work (ordered → in_progress → ready → done)

### UI/UX
- [ ] Done button is the most prominent element (L15 rule)
- [ ] Status badge clear

---

## Surface 12 — POS Today (`/pos/today`)

### Functional
- [ ] Today's order count shown
- [ ] Revenue KPIs correct
- [ ] Refreshes or shows correct day

---

## Surface 13 — Admin Dashboard (`/admin`)

### Functional
- [ ] Admin login (admin PIN) → correct dashboard
- [ ] COGS dashboard shows charts if owner role
- [ ] Finance/manager → card grid shows all sections

### UI/UX
- [ ] Sidebar navigation links all work
- [ ] Active nav item highlighted
- [ ] Breadcrumb or page title present on sub-pages

---

## Surface 14 — Admin Customers (`/admin/customers`)

### Functional
- [ ] Customer search by name/email works
- [ ] Clicking customer → detail page
- [ ] Detail page shows Orders / Loyalty / Wallet / Packs tabs
- [ ] Loyalty tab shows audit history
- [ ] Wallet tab shows balance + transactions

### UI/UX
- [ ] Table columns aligned
- [ ] Search input debounce (not firing on every keystroke)
- [ ] Empty state message for no results

---

## Surface 15 — Admin Loyalty Audit (`/admin/loyalty`)

### Functional
- [ ] Loyalty transactions listed (earn/redeem/adjustment/expiry)
- [ ] Filter by kind works
- [ ] **"Adjust Balance" button** opens AdjustLoyaltyDialog ← **NEW AT-123**
- [ ] Customer search in dialog finds customer
- [ ] Entering delta + reason submits successfully
- [ ] New adjustment appears in audit table
- [ ] Negative delta blocked if it would push balance below 0
- [ ] Error shown for empty reason or zero delta

### UI/UX
- [ ] Dialog opens smoothly
- [ ] Customer search suggestions appear in dropdown
- [ ] Reason input clearly labelled (min 3 chars)
- [ ] Delta shows +/− clearly
- [ ] Success message shows new balance

---

## Surface 16 — Admin Loyalty Liability Report (`/admin/loyalty/liability`) ← **NEW AT-127**

### Functional
- [ ] Page loads without error
- [ ] Total outstanding points shown
- [ ] Estimated liability in ZAR shown (formatZar)
- [ ] Active customers count
- [ ] Average points shown
- [ ] Top 10 holders table renders with rank, name, points, liability, last activity
- [ ] CSV export link works → downloads file with correct columns

### UI/UX
- [ ] KPI tiles clearly distinguished
- [ ] Table rows aligned
- [ ] CSV link looks like a button/action, not a raw link

---

## Surface 17 — Admin Loyalty Reconciliation (`/admin/loyalty/reconcile`) ← **NEW AT-124**

### Functional
- [ ] Page loads without error
- [ ] Summary line shows "X customers checked, Y drifted"
- [ ] If no drift: green "All balances reconciled" message
- [ ] If drift: table shows Customer ID, Name, Cached, Ledger, Delta
- [ ] Re-run link/button triggers a fresh reconciliation

### UI/UX
- [ ] Green success state is visually clear
- [ ] Drift delta column shows sign (+/−)
- [ ] Page title and description explain what this does

---

## Surface 18 — Admin Reports, Staff, Menu, Inventory

These are pre-existing. Quick smoke test:
- [ ] `/admin/reports` — export form renders, at least one export type works
- [ ] `/admin/staff` — staff list loads, create staff dialog opens
- [ ] `/admin/menu` — menu items listed with prices
- [ ] `/admin/inventory` — items table loads

---

## Push Notifications

- [ ] Customer opt-in: go to `/customer/settings`, toggle notifications, browser prompts for permission
- [ ] After an order transitions to `ready`, customer receives "order ready" push
- [ ] After earn on order completion, customer receives "Points earned ☕" push ← **NEW AT-128**
- [ ] Verify push payload: "You earned N pts. Balance: N pts."

---

## UI/UX Audit — Cross-Cutting Issues to Check

### Typography & Spacing
- [ ] Heading hierarchy consistent (h1 → h2 → h3) across surfaces
- [ ] Line-height comfortable on mobile (not too tight)
- [ ] No orphaned single words on short lines

### Colour & Contrast
- [ ] All text passes WCAG AA contrast (4.5:1 minimum)
- [ ] Error states are red, not just styled text
- [ ] Success states are green
- [ ] Disabled states are clearly greyed

### Forms & Inputs
- [ ] All inputs have visible labels (no placeholder-only)
- [ ] Required fields marked
- [ ] Validation fires on blur, not just submit
- [ ] Submit button disabled during loading (no double-submit)
- [ ] Keyboard navigation works (tab order sensible)

### Empty States
- [ ] Every list/table has an empty state message (not a blank void)
- [ ] Empty states have a helpful next action where possible

### Error States
- [ ] Network errors show a message (not a white screen)
- [ ] 404 page exists and is branded
- [ ] Form errors show inline, not just in a toast that disappears

### Loading States
- [ ] SSR pages: no layout shift on hydration
- [ ] Client actions: spinner/disabled state on button
- [ ] No "flash of unauthenticated content"

### Mobile Responsiveness (test at 375px, 390px, 428px)
- [ ] No horizontal scroll on any page
- [ ] Touch targets ≥ 44px (especially keypad, buttons)
- [ ] Modals/dialogs don't overflow viewport
- [ ] Tables scroll horizontally inside their container (not the whole page)

### Navigation
- [ ] "Back" links/buttons present on all detail pages
- [ ] Breadcrumbs or page titles on admin sub-pages
- [ ] Browser back button works as expected (no stuck modals)

### Consistency
- [ ] Customer pages all use the same nav pattern (FAVO wordmark + Back)
- [ ] Admin pages all use the same `admin-page-title` heading class
- [ ] POS pages use consistent dark-bg pattern
- [ ] Toast/notification position consistent (bottom-right or top-right, pick one)

---

## Surface 19 — Navigation Flows (sign-in / sign-out / page transitions)

These are the critical user journeys to verify end-to-end:

### Customer flow
- [ ] `/` → "Order now" or any CTA → `/login` (if not signed in) or `/customer` (if signed in)
- [ ] `/login` → sign in → `/customer` (dashboard)
- [ ] `/customer` → FAVO wordmark → `/` (home)
- [ ] `/customer` → Settings link → `/customer/settings`
- [ ] `/customer` → "View history →" on LoyaltyCard → `/loyalty`
- [ ] `/loyalty` → back arrow → `/customer`
- [ ] `/customer/settings` → Sign out → `/login` or `/`
- [ ] Direct-to-protected URL while logged out (e.g. `/customer`) → redirect to `/login`
- [ ] After sign-out, browser back button does NOT show protected content

### Staff / barista flow
- [ ] `/staff/login` → "← Home" link → `/`
- [ ] `/staff/login` → PIN `1234` → `/pos/queue`
- [ ] `/pos/queue` → sign out (avatar/button) → `/staff/login`
- [ ] Direct URL `/pos/queue` while logged out → redirect to `/staff/login`
- [ ] After sign-out, browser back does NOT let barista back into POS

### Admin flow
- [ ] `/staff/login` → PIN `4321` → `/admin`
- [ ] `/admin` sidebar → Loyalty → `/admin/loyalty`
- [ ] `/admin` sidebar → Loyalty → ↳ Reconcile → `/admin/loyalty/reconcile`
- [ ] `/admin` sidebar → Loyalty → ↳ Liability → `/admin/loyalty/liability`
- [ ] `/admin` sidebar → Audit log → `/admin/audit`
- [ ] `/admin` → sign out → `/staff/login`
- [ ] Direct URL `/admin` while logged out → redirect to `/staff/login`
- [ ] Barista PIN `1234` cannot access `/admin` (redirected to `/pos/queue`)

### Cross-surface dead-end check
- [ ] No page leaves the user with no navigation option (stuck/dead-end)
- [ ] 404 page has a link back to `/`
- [ ] Error boundaries / error pages have a "Go home" action

---

## Known Issues to Investigate

- [x] **Sidebar.tsx** — "Reconcile" and "Liability" sub-links added (2026-06-21)
- [x] `/loyalty` — accessible from customer dashboard via LoyaltyCard "View history →" link (2026-06-21)
- [x] Staff login dead-end — "← Home" link added (2026-06-21)
- [ ] `formatDate()` — confirm Africa/Johannesburg timezone across all date displays
- [ ] After all PRs merge, run `bun test:unit --run` locally to confirm 904+ tests still pass

---

## How to File a UI Issue

For each issue found, note:
1. **Route** — which page
2. **What's wrong** — description
3. **Screenshot/viewport** — device size
4. **Priority** — P1 (broken/blocking) | P2 (looks wrong) | P3 (minor polish)

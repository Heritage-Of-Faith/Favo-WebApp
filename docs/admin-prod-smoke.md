# Admin Prod Smoke — AT-89 (A19)

**Owner:** Mia Ligthelm  
**Phase:** HOFMI-FAVO-P4  
**When:** Launch day · 11:00–13:00 SAST · after G26 (Coolify deploy) confirms green  
**Target:** `https://favo.hofmi.org/admin`

> **Note on HOFMI SSO:** SSO is a future enhancement (auth.ts comment). Admin login uses PIN on launch day. Use the staff PIN from the production seed or Gian's launch prep.

---

## Pre-conditions

- [ ] G26 deploy reported green to `#favo-ops`
- [ ] DNS resolving correctly (`favo.hofmi.org` → production)
- [ ] Admin PIN from Gian's production seed ready
- [ ] Browser console open (F12 → Console) before navigating

---

## Step 1 — Admin login

Navigate to `https://favo.hofmi.org/admin`.

**Expected:** Redirects to `/admin/login`. PIN keypad visible.

- [ ] Redirect happens cleanly
- [ ] PIN keypad renders with all 10 digits

Enter your PIN.

**Expected:** Redirects to `/admin` dashboard.

- [ ] Dashboard visible
- [ ] Sidebar visible with navigation links
- [ ] Zero console errors

**Screenshot:** _paste screenshot here_

---

## Step 2 — COGS dashboard

Navigate to `/admin` (or click Dashboard in sidebar).

**Expected:** COGS dashboard renders. Numbers may be zero on a fresh prod DB — the assertion is that it renders without error.

- [ ] Page renders (no error screen, no 500)
- [ ] KPI tiles visible (even if showing R 0.00)
- [ ] Zero console errors

**Screenshot:** _paste screenshot here_

---

## Step 3 — Hours editor

Navigate to `/admin/hours`.

**Expected:** Hours editor renders with Mon–Sun rows.

- [ ] 7 day rows visible (Mon through Sun)
- [ ] Open/close time inputs present
- [ ] "Closed all day" checkboxes present
- [ ] "Save hours" button present

**Screenshot:** _paste screenshot here_

---

## Step 4 — CSV export

Navigate to `/admin/reports`.

**Expected:** Export form renders.

- [ ] Report type selector visible
- [ ] Format selector (CSV / PDF) visible
- [ ] Date range inputs visible

Select **Sales** · **CSV** · current month. Click **Export**.

- [ ] Download initiated (file appears in Downloads)
- [ ] CSV file opens without errors
- [ ] "Exported Sales (csv)" confirmation message shown

**Downloaded filename:** ___________  
**Screenshot:** _paste screenshot here_

---

## Step 5 — PDF export

Same page: select **Monthly P&L** · **PDF** · current month. Click **Export**.

- [ ] Download initiated
- [ ] PDF opens without errors

**Downloaded filename:** ___________  
**Screenshot:** _paste screenshot here_

---

## Step 6 — Customers page

Navigate to `/admin/customers`.

- [ ] Page renders
- [ ] Search input visible
- [ ] (Optional) search for "Louis" — seed customer should appear

**Screenshot:** _paste screenshot here_

---

## Step 7 — Sync conflicts page

Navigate to `/admin/sync-conflicts`.

- [ ] Page renders
- [ ] "Open (N)" heading visible
- [ ] (Expected to show 0 open conflicts on a fresh prod DB)

**Screenshot:** _paste screenshot here_

---

## Step 8 — Audit log

Navigate to `/admin/audit`.

- [ ] Page renders
- [ ] At least 1 audit entry visible (login events from this smoke will have been written)

**Screenshot:** _paste screenshot here_

---

## Result

**Smoke status:** ⬜ PASS / ⬜ FAIL  
**Completed by:** Mia Ligthelm  
**Time completed:** ___________  
**Any issues found:**

```
(none / describe here)
```

**Reported to #favo-ops at:** ___________

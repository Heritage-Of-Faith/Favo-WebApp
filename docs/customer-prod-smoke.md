# Customer Prod Smoke — AT-93 (N19)

**Owner:** Nikao du Toit  
**Phase:** HOFMI-FAVO-P4  
**When:** Launch day · 11:00–13:00 SAST · after G26 (Coolify deploy) confirms green  
**Device:** Real Android Chrome (not desktop, not emulated)  
**Target:** `https://favo.hofmi.org`

---

## Pre-conditions

- [ ] G26 deploy has reported green to `#favo-ops`
- [ ] DNS resolving correctly (`favo.hofmi.org` → production)
- [ ] Android Chrome, latest version, fresh incognito tab
- [ ] Test email address ready: use `nikao+smoke@hofmi.net` (or a personal address you can receive email on)
- [ ] Coordinate with Mine: agree the exact time for Mine's M21 test order so you can confirm push delivery

---

## Step 1 — Landing page

Navigate to `https://favo.hofmi.org` in incognito Chrome.

**Expected:** FAVO landing page loads. FAVO wordmark, hero section, footer visible.

- [ ] Page loads without errors
- [ ] Console: no red errors (open DevTools → Console before navigating)
- [ ] Footer shows "Privacy policy" link

**Screenshot:** _paste screenshot here_

---

## Step 2 — Account creation

Tap **Sign in** → **Create an account**.

Fill in:
- **Name:** `Nikao Smoke Test`
- **Email:** your test email
- **Phone:** your real number
- **Password:** a strong password (do not commit to this doc)
- **Confirm password:** same

Tap **Create account**.

**Expected:** Redirected to `/customer` (dashboard).

- [ ] Redirect happens within 5 seconds
- [ ] Dashboard renders (loyalty section, wallet section visible)

**Screenshot:** _paste screenshot here_

---

## Step 3 — Dashboard verify

On the customer dashboard:

- [ ] FAVO wordmark in nav
- [ ] Loyalty section visible (points balance — will be 0 on fresh account)
- [ ] Wallet section visible (balance R 0.00 or equivalent)
- [ ] Operating hours section visible
- [ ] Push opt-in prompt visible (or "Enable notifications" button)
- [ ] No JavaScript errors in DevTools console

**Screenshot:** _paste screenshot here_

---

## Step 4 — Push notification opt-in

Tap **Enable notifications** (or the push opt-in prompt).

**Expected:** Android Chrome shows a permission prompt "favo.hofmi.org wants to send you notifications". Tap **Allow**.

- [ ] Permission prompt appears
- [ ] After tapping Allow: button changes state (e.g. "Notifications enabled") or disappears

**Screenshot:** _paste screenshot here_

---

## Step 5 — Push delivery test (coordinate with Mine)

Agree a time with Mine. Mine will create a test order for this customer using the POS (M21), then transition it to "Ready".

**Start time:** ___________  
**Mine's order ID:** ___________

- [ ] Push notification received on Android within **10 seconds** of Mine transitioning order to "Ready"
- [ ] Notification shows order details

**Delivery time (seconds after Mine's tap):** ___________

**Screenshot:** _paste screenshot here_

---

## Step 6 — Wallet page

Navigate to `/wallet` (tap Wallet in nav or go directly).

- [ ] Page loads without errors
- [ ] Balance shows R 0.00
- [ ] Transaction history empty (expected for new account)

**Screenshot:** _paste screenshot here_

---

## Step 7 — Packs page

Navigate to `/packs`.

- [ ] Page loads without errors
- [ ] "No active packs" message (or equivalent) — expected for new account

**Screenshot:** _paste screenshot here_

---

## Step 8 — Privacy page

Navigate to `/privacy`.

- [ ] Page loads without errors
- [ ] "Privacy Policy" heading visible
- [ ] Contact email `privacy@hofmi.org` visible
- [ ] Information Regulator link present

**Screenshot:** _paste screenshot here_

---

## Step 9 — SQL verification (with Gian)

Ask Gian to run the following query to confirm the push subscription is stored correctly:

```sql
SELECT ps.id, ps.customer_id, c.email, ps.created_at
FROM push_subscriptions ps
JOIN customers c ON c.id = ps.customer_id
WHERE c.email = '<your-test-email>'
ORDER BY ps.created_at DESC
LIMIT 1;
```

- [ ] Row found with correct `customer_id`
- [ ] `created_at` matches your opt-in time

---

## Result

**Smoke status:** ⬜ PASS / ⬜ FAIL  
**Completed by:** Nikao du Toit  
**Time completed:** ___________  
**Any issues found:**

```
(none / describe here)
```

**Reported to #favo-ops at:** ___________

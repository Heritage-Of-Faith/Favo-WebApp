# FAVO Café — Privacy Policy

**Last updated:** 17 June 2026  
**Effective date:** 17 June 2026

---

## Who we are

FAVO Café is operated by Heritage of Faith Ministries (HOFMI), a South African non-profit organisation based in Reyno Ridge, Emalahleni (Witbank), Mpumalanga.

**Responsible party (POPIA):**  
Heritage of Faith Ministries  
7 Duiker Street, Reyno Ridge, Emalahleni, 1049, South Africa  
Contact: privacy@hofmi.org

---

## What information we collect and why

| Data | Why we collect it | Legal basis |
|---|---|---|
| **Email address** | Account creation, signing in to your rewards account | Contractual necessity |
| **Full name** | Personalising your loyalty account; barista search at the counter | Contractual necessity |
| **Phone number** | Counter lookup by baristas; emergency contact for order issues | Legitimate interest |
| **Purchase history** | Calculating loyalty points and wallet credits; generating your order history | Contractual necessity |
| **Loyalty points balance** | Awarding and redeeming points per the loyalty programme rules | Contractual necessity |
| **Wallet balance and transactions** | Recording wallet credits and debits accurately | Contractual necessity |
| **Coffee pack purchases and redemptions** | Tracking active packs and expiry dates (packs expire 90 days after purchase) | Contractual necessity |
| **Push notification subscription** | Sending you order-ready alerts and café announcements when you opt in | Consent (you can withdraw at any time) |
| **Audit log entries** | Maintaining an accurate and tamper-proof record of every change to your account | Legal obligation (financial records) |

We do **not** store payment card details. All card payments are processed by Yoco using their hosted payment page. FAVO never sees or logs your card number, CVV, or expiry date.

---

## How long we keep your data

| Data | Retention period | Rationale |
|---|---|---|
| Customer account (name, email, phone) | Until you request deletion | Contractual relationship |
| Order and payment history | Indefinitely (minimum 5 years) | Tax and financial audit requirements |
| Loyalty, wallet, and pack records | Indefinitely | Financial ledger integrity |
| Audit log | Indefinitely (append-only) | Legal obligation — tamper-proof financial audit trail |
| Push subscriptions | Until revoked by your browser or you withdraw consent | Consent-based |

---

## Who can access your data

FAVO operates strict role-based access control (RBAC). No staff member can access data beyond their role.

| Role | What they can see |
|---|---|
| **Barista** | Your name and phone number (to find your account at the counter). Cannot view wallet amounts or order history. |
| **Manager / Admin** | Full customer profile, order history, loyalty and wallet records, for support purposes. |
| **Owner** | Full access for oversight and compliance purposes. |

Your data is stored on Supabase (eu-west-1, Frankfurt, Germany) under a tenant-isolated database. No data is shared with third parties except Yoco for payment processing.

---

## Your rights under POPIA

As a data subject, you have the right to:

1. **Access** — request a copy of all personal information we hold about you
2. **Correction** — request correction of inaccurate or incomplete information
3. **Deletion** — request erasure of your personal information (subject to our legal retention obligations — financial records cannot be deleted, but PII can be anonymised)
4. **Objection** — object to processing based on legitimate interest
5. **Complaint** — lodge a complaint with the Information Regulator of South Africa

**To exercise any of these rights**, email privacy@hofmi.org. We will respond within 30 days.

**Note on audit log anonymisation:** Our audit log is legally required to be append-only — individual entries cannot be deleted. When a deletion request is received, we process it by inserting a follow-up audit row that replaces your personal information with a redaction marker (`[REDACTED:popia-request-{id}]`). Financial transaction amounts and timestamps are preserved (no PII) as required by tax law.

---

## Cookies and local storage

The FAVO web app uses a signed session cookie to keep you signed in. No third-party analytics cookies are set. The offline POS (barista-facing) stores order data in browser IndexedDB for up to 30 minutes while offline — this data never includes your personal details.

---

## Changes to this policy

We will notify registered customers by email if we make material changes to this policy. The "Last updated" date at the top will always reflect the current version.

---

## Contact

For privacy enquiries, subject access requests, or complaints:  
**Email:** privacy@hofmi.org  
**Post:** Heritage of Faith Ministries, 7 Duiker Street, Reyno Ridge, Emalahleni, 1049

For complaints to the regulator:  
**Information Regulator of South Africa** — [inforegulator.org.za](https://inforegulator.org.za)

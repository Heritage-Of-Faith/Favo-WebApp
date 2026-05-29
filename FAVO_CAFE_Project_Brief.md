# FAVO CAFE Web App - Project Brief & Architecture

**Status:** Project Planning  
**Timeline:** 1 Week MVP  
**Last Updated:** May 6, 2026

---

## 🎯 Project Overview

FAVO CAFE is building a comprehensive coffee shop management platform with dual functionality:
- **Internal:** Manager/Barista/Roaster dashboard for operations, inventory, and loyalty tracking
- **Public:** Customer-facing loyalty program (web + mobile-responsive)

**Key Business Model:**
- **Daily Operations:** 50 employees - each gets 1 FREE coffee/day (resets at midnight)
- **Weekly Public:** Sundays + ongoing public access (no artificial limits)
- **Integration:** All transactions via YOCO payment processor (live sync)

---

## 👥 User Roles & Permissions

### 1. **Customer** (Web + Mobile-responsive)
- View loyalty points & balance
- Check when next free coffee is available
- Register via phone number (gets QR code)
- Scan QR code OR provide M-number at counter
- View loyalty history
- Track personal purchase history
- **Employee Badge:** Shows "Employee" label if part of daily 50

### 2. **Employee** (Customer + Special Features)
- Same as Customer
- Badge showing "Employee - 1 Free Coffee Today"
- Daily free coffee counter
- Can purchase additional coffees = loyalty points
- Free coffee resets at midnight automatically

### 3. **Barista/Staff** (Backend)
- View sales transactions (real-time)
- Update inventory (milk, sugar, cups, syrups, etc.)
- Log customer scans/purchases
- View loyalty member details
- Access to quick-lookup functions
- **NO Manager Dashboard access**

### 4. **Roaster** (Backend)
- Log roasting batches (factory-style process tracking)
- Track green bean inventory
- Track roasted bean inventory
- View inventory levels
- Log bean usage & production
- **NO full Manager Dashboard access** (only bean-related metrics)

### 5. **Manager** (Full Admin Dashboard)
- View all metrics (sales, inventory, loyalty, operations)
- Separate views: Employee segment vs. Public Customer segment
- Manage users (add/remove employees)
- Update/modify inventory
- View analytics & reports
- Access all staff dashboards
- Set business hours/operational settings

---

## 🏗️ Core Features Breakdown

### **Feature 1: Loyalty Program**
**Mechanics:**
- **Ratio:** 1 free coffee per 10 purchased (1:10)
- **Accumulation:** Loyalty builds continuously; don't need to redeem to restart
- **Registration:** Phone number → auto-generates QR code + M-number
- **Redemption:** 
  - Scan QR at counter, OR
  - Provide M-number verbally
  - System shows "1 FREE COFFEE AVAILABLE" when threshold hit
- **Real-time Claim:** Customer can claim free coffee immediately upon hitting 10 coffees (live YOCO sync)
- **Daily Free (Employees):** 1 automatic free coffee resets at midnight; additional purchases = loyalty points

**Data Tracked:**
- Phone number → M-number
- Total coffees purchased
- Points accumulated
- Free coffees earned
- Free coffees redeemed
- Purchase history
- Last purchase date
- Member since date

---

### **Feature 2: Manager Dashboard**

#### **Dashboard View Options:**
1. **Combined Metrics** (Overview Tab)
   - Total Sales (Today, Week, Month)
   - Total Members
   - Active Members (purchased in last 7 days)
   - Inventory Status (low-stock alerts)

2. **Employee Segment Tab**
   - Employee sales & revenue
   - Daily free coffee redemptions (today vs. week)
   - Employee loyalty stats
   - Employee member count

3. **Public Customer Segment Tab**
   - Public sales & revenue
   - Public loyalty redemptions
   - Public member growth
   - Repeat customer rate

#### **Key Widgets:**
- **Sales Widget**
  - Today's sales amount
  - Daily vs. weekly breakdown
  - Comparison to previous week/month
  - Revenue by segment (Employee vs. Public)

- **Inventory Widget**
  - Green beans (kg/units)
  - Roasted beans (kg/units)
  - Milk (liters/units)
  - Sugar (kg/units)
  - Cups, lids, sleeves (count)
  - Custom items (syrups, etc.)
  - **Low-stock alerts** (red flag if below threshold)
  - Last updated timestamp

- **Loyalty Widget**
  - Total members
  - Active members (last 30 days)
  - Members with pending free coffee
  - Free coffees redeemed (today/week)
  - Engagement rate (% who purchased this week)

- **Favorite of the Week**
  - Auto-calculated from sales data
  - Shows #1 most-sold coffee
  - Volume sold
  - Revenue from that item
  - Shows which segment (Employee/Public)

- **Quick Actions**
  - Add new employee
  - Log inventory update
  - View today's transactions
  - View loyalty member details

---

### **Feature 3: Roaster Backend**

#### **Roasting Batch Log**
- Batch ID (auto-generated)
- Date & time started
- Roast type (light, medium, dark, etc.)
- Green bean type used
- Quantity (kg)
- Roast time (duration)
- Roast temperature
- Result quality (notes)
- Status (In Progress, Complete, Archived)
- Batch history

#### **Inventory Tracking**
- Green bean current stock
- Green bean usage log (deduct when roasting)
- Roasted bean current stock
- Roasted bean usage log (deduct when sold)
- Reorder alerts (when below 10kg green beans)
- Production yield tracking

---

### **Feature 4: Barista/Staff Interface**

**Quick Entry:**
- New customer phone number input → generates QR
- M-number lookup (if customer forgot phone)
- Quick scan/punch for loyalty tracking
- Inventory deduction (when they use milk, sugar, etc.)
- Transaction confirmation (pulled from YOCO)

---

### **Feature 5: YOCO Integration**

**Data to Pull:**
- Real-time transaction list
- Amount
- Payment method
- Timestamp
- Customer identification (if available)
- Refunds
- Failed transactions
- Transaction history (past 30 days minimum)

**Sync Strategy:**
- **Live:** Loyalty claim eligibility updates (customer at 10 coffees can redeem NOW)
- **Real-time:** Sales dashboard refreshes as transactions occur
- **Batch:** Daily reconciliation (end-of-day sync)

**Data Flow:**
```
YOCO Machine → API → FAVO Web App → 
  ├─ Loyalty Points Calculation
  ├─ Inventory Deduction
  ├─ Sales Dashboard Update
  └─ Manager Alerts (low stock, high sales, etc.)
```

---

### **Feature 6: Employee Management**

**For Managers:**
- Add new employee (name, phone, email)
- Remove employee (deactivate account)
- View employee list
- View employee loyalty data separately
- Mark as "Employee" status
- Reset daily free coffee (if needed)
- View employee purchase history

---

## 🎨 Public-Facing Website

### **Customer Loyalty Portal**

**Home Page:**
- Login/Register section
  - Phone number entry
  - Option to download QR code
  - Or provide M-number

**Dashboard (Logged In):**
- "Your Loyalty Status"
  - Total coffees purchased
  - Free coffees earned
  - Free coffees redeemed
  - Points towards next free coffee (e.g., "4 out of 10")
  - **If Employee:** "1 Free Coffee Available Today (Resets at Midnight)"

- Purchase History
  - Date, item, amount
  - Points earned
  
- Your QR Code
  - Downloadable/screenshotable
  - M-number alternative
  
- Coffee Shop Info
  - Hours (Daily: X-Y, Sunday: Public)
  - Location
  - Contact

- Featured Coffee (Favorite of Week)
  - What's trending this week
  - Photo
  - Sales count
  - Recommendation

---

## 📱 Mobile Responsiveness

All features should be mobile-optimized:
- Easy QR code display (doesn't shrink on small screens)
- Simple loyalty point calculation
- Fast login (phone number)
- Touch-friendly buttons
- Works offline (for QR display at register)

---

## 🚀 MVP (Week 1) vs. Phase 2

### **MVP - MUST HAVE:**
✅ Loyalty program (phone registration → QR code → loyalty tracking)  
✅ Manager dashboard (sales, inventory, members count)  
✅ Employee vs. Public customer segment views  
✅ Inventory management (staff can update)  
✅ YOCO integration (read transactions, calculate loyalty)  
✅ Roaster batch logging  
✅ Favorite of the week (auto-calculated)  
✅ Employee badge & daily free coffee logic  

### **Phase 2 - NICE TO HAVE:**
- 📊 Advanced analytics & reporting
- 📧 Email notifications (low inventory, daily free coffee reminder)
- 📱 Native mobile app (vs. responsive web)
- 💳 In-app payment (buy credits)
- 🎯 Gamification (badges, levels, streaks)
- 📸 Photo gallery (AI-generated coffee images, employee photos)
- 🔔 Push notifications
- 📈 Predictive analytics (forecast inventory needs)
- 🛠️ API for third-party integrations
- 🌐 Multi-language support

---

## 🛠️ Recommended Tech Stack

| Component | Recommendation | Notes |
|-----------|---|---|
| **Frontend** | React.js or Next.js | Fast, responsive, mobile-friendly |
| **Backend** | Node.js + Express OR Python/Django | APIs for loyalty, inventory, analytics |
| **Database** | PostgreSQL or MongoDB | Store customer, transactions, inventory |
| **Authentication** | Phone-based (SMS OTP or simple phone verification) | No username/password friction |
| **YOCO API** | Webhook + REST API integration | Real-time transaction sync |
| **Hosting** | Vercel (frontend) + Heroku/Railway (backend) | Easy deployment, scalable |
| **Charts/Analytics** | Chart.js or Recharts | Dashboard visualizations |
| **QR Code Generation** | `qrcode.react` or `qr-code-styling` | On-the-fly QR generation |

---

## 📊 Data Schema Overview

### **Users Table**
```
- user_id (PK)
- phone_number (UNIQUE)
- m_number (auto-generated)
- name
- email
- is_employee (boolean)
- created_at
- last_login
- status (active/inactive)
```

### **Loyalty Table**
```
- loyalty_id (PK)
- user_id (FK)
- coffees_purchased (count)
- free_coffees_earned (count)
- free_coffees_redeemed (count)
- last_purchase_date
- points_balance
```

### **Transactions Table**
```
- transaction_id (PK)
- user_id (FK) [nullable - walk-in customers]
- yoco_transaction_id
- amount
- date_time
- payment_method
- free_coffee_applied (boolean)
- segment (employee/public)
```

### **Inventory Table**
```
- item_id (PK)
- item_name
- category (bean/supply/dairy)
- current_stock
- unit (kg/liters/count)
- low_stock_threshold
- last_updated
- updated_by (user_id)
```

### **Roasting Batches Table**
```
- batch_id (PK)
- green_bean_type
- quantity_kg
- roast_date
- roast_time_minutes
- roast_level
- roasted_quantity_kg
- status
- notes
```

---

## 🔐 Security Considerations

- Phone number validation (SMS or simple verification)
- YOCO API key secured (environment variables)
- QR codes are one-time or short-lived (prevent screenshot sharing)
- Inventory updates require authentication
- Manager dashboard requires strong auth
- No sensitive data in URLs
- HTTPS everywhere
- Rate limiting on API endpoints
- Input validation on all forms

---

## 📅 Week 1 Milestone Checklist

- [ ] Database schema designed & created
- [ ] User authentication (phone-based) implemented
- [ ] Loyalty program logic (1:10 ratio, point tracking)
- [ ] QR code generation & display
- [ ] YOCO API integration (read transactions)
- [ ] Manager dashboard (basic widgets: sales, inventory, members)
- [ ] Employee vs. Public segment toggle
- [ ] Employee daily free coffee logic
- [ ] Roaster batch logging interface
- [ ] Inventory update functionality
- [ ] Favorite of the week calculation
- [ ] Mobile responsiveness tested
- [ ] Deploy to staging/demo environment
- [ ] Interactive demo ready for stakeholders

---

## 🎓 Next Steps

1. **Confirm Tech Stack** — Are you happy with React/Node recommendation?
2. **Design Mockups** — Should we create UI wireframes before coding?
3. **Database Design** — Finalize data schema
4. **YOCO API Docs** — Get API keys & documentation ready
5. **Start Development** — Begin with authentication + loyalty core

---

## 📞 Questions for Refinement

1. **YOCO Data:** Do you have YOCO API documentation? Can we pull customer metadata from transactions?
2. **QR Code Uniqueness:** Should each customer have ONE QR code (tied to phone), or can they generate new ones?
3. **Free Coffee Mechanics:** When employee claims free coffee (uses 1), does the counter reset to 0/10, or does it keep counting towards the NEXT free coffee?
4. **Reporting:** Do you need daily/weekly email summaries sent to manager?
5. **Backup Phone Entry:** At register, if QR fails to scan, can barista type M-number manually?


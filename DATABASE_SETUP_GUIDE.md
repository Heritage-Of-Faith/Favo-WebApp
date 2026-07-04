# FAVO CAFE Database Setup Guide

**Status:** Ready to Follow  
**Database:** PostgreSQL  
**Level:** Beginner-Friendly

---

> **Security invariants are applied via Drizzle migrations — not by hand.**
> As of migrations `0021`–`0023`:
> - **Audit trigger (append-only, L08/L12):** `drizzle/0021_audit_log_append_only.sql`
>   installs `audit_log_immutable()` + BEFORE UPDATE/DELETE triggers on
>   `audit_log`. No role can update or delete an audit row.
> - **Row-Level Security (customer isolation, L13):** `drizzle/0023_rls_customer_isolation.sql`
>   creates the `favo_customer` NOLOGIN role, enables (does **not** force) RLS on
>   the customer-readable tables, and adds SELECT policies scoped to
>   `current_setting('app.current_customer_id')`. Customer dashboard reads run
>   through `withCustomerScope()` (`src/lib/db-rls.ts`), which `SET LOCAL ROLE
>   favo_customer` inside a transaction. Staff/admin/system use the owner
>   connection and bypass RLS (owner is exempt from non-forced RLS), so they are
>   unaffected.
> - **CHECK constraints:** `wallet_zar >= 0` and `loyalty_points >= 0` (L06,
>   `drizzle/0016_*` and `drizzle/0020_loyalty_points_check.sql`).
>
> The `db/sql/*.sql` files are design references kept in sync with these
> migrations; the migrations are the canonical, applied definitions. Run
> `bun db:migrate` to apply.

---

## 📋 What You'll Learn

By the end of this guide, you'll have:
- ✅ PostgreSQL installed on your computer
- ✅ A database created for FAVO CAFE
- ✅ All tables set up with correct structure
- ✅ Sample data to test with
- ✅ Ready to connect to your web app

---

## 🛠️ Step 1: Install PostgreSQL

### **On Mac:**
1. Download: https://www.postgresql.org/download/macosx/
2. Run the installer
3. During setup, remember the password you create (you'll need it!)
4. Complete installation

**Verify installation:**
```bash
psql --version
```
You should see: `psql (PostgreSQL) 15.x` or similar

### **On Windows:**
1. Download: https://www.postgresql.org/download/windows/
2. Run installer
3. Remember your password!
4. During installation, keep default port `5432`

**Verify installation:**
Open Command Prompt and run:
```bash
psql --version
```

### **Already have PostgreSQL?**
Great! You can skip to Step 2.

---

## 🗄️ Step 2: Create Your Database

Open your terminal/command prompt and run:

```bash
psql -U postgres
```

When prompted, enter the password you created during installation.

You should see the prompt: `postgres=#`

Now create the database:

```sql
CREATE DATABASE favo_cafe;
```

You should see: `CREATE DATABASE`

Then connect to your new database:

```sql
\c favo_cafe
```

You should see: `You are now connected to database "favo_cafe" as user "postgres".`

Great! Now you're ready to create tables.

---

## 📊 Step 3: Create All Tables

Copy and paste the following SQL code into your `psql` prompt. This creates all the tables you need:

```sql
-- Users Table (Customers, Employees, Staff)
CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  phone_number VARCHAR(15) UNIQUE NOT NULL,
  m_number VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  email VARCHAR(100),
  is_employee BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active'
);

-- Loyalty Points Tracking
CREATE TABLE loyalty (
  loyalty_id SERIAL PRIMARY KEY,
  user_id INT UNIQUE NOT NULL,
  coffees_purchased INT DEFAULT 0,
  free_coffees_earned INT DEFAULT 0,
  free_coffees_redeemed INT DEFAULT 0,
  last_purchase_date TIMESTAMP,
  points_balance INT DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Transactions (Sales from YOCO)
CREATE TABLE transactions (
  transaction_id SERIAL PRIMARY KEY,
  user_id INT,
  yoco_transaction_id VARCHAR(100) UNIQUE,
  amount DECIMAL(10, 2) NOT NULL,
  transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  payment_method VARCHAR(50),
  free_coffee_applied BOOLEAN DEFAULT FALSE,
  segment VARCHAR(20),
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Inventory Items (Milk, Sugar, Beans, Cups, etc.)
CREATE TABLE inventory (
  item_id SERIAL PRIMARY KEY,
  item_name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  current_stock DECIMAL(10, 2) NOT NULL DEFAULT 0,
  unit VARCHAR(20),
  low_stock_threshold DECIMAL(10, 2),
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by INT,
  FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Inventory History Log
CREATE TABLE inventory_log (
  log_id SERIAL PRIMARY KEY,
  item_id INT NOT NULL,
  quantity_changed DECIMAL(10, 2),
  new_stock DECIMAL(10, 2),
  reason VARCHAR(100),
  changed_by INT,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES inventory(item_id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Roasting Batches
CREATE TABLE roasting_batches (
  batch_id SERIAL PRIMARY KEY,
  green_bean_type VARCHAR(100),
  quantity_kg DECIMAL(10, 2),
  roast_date DATE NOT NULL,
  roast_time_minutes INT,
  roast_level VARCHAR(50),
  roasted_quantity_kg DECIMAL(10, 2),
  roasted_by INT,
  status VARCHAR(50) DEFAULT 'in_progress',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (roasted_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Employee Daily Free Coffee Tracker (resets at midnight)
CREATE TABLE daily_free_coffee (
  daily_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  date DATE DEFAULT CURRENT_DATE,
  free_coffee_used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE(user_id, date)
);

-- Weekly Favorites Log
CREATE TABLE weekly_favorites (
  favorite_id SERIAL PRIMARY KEY,
  week_start_date DATE NOT NULL,
  item_name VARCHAR(100),
  total_sold INT,
  revenue DECIMAL(10, 2),
  segment VARCHAR(20),
  UNIQUE(week_start_date, item_name)
);
```

Paste this into psql and press Enter. You should see messages like:
```
CREATE TABLE
CREATE TABLE
...
```

✅ **All tables created!**

---

## 💾 Step 4: Add Sample Data (Optional but Helpful)

This creates sample data so you can test your app. Copy and paste:

```sql
-- Add sample users (employees)
INSERT INTO users (phone_number, m_number, name, is_employee, status) 
VALUES 
('0827654321', 'M001', 'Alice Johnson', TRUE, 'active'),
('0827654322', 'M002', 'Bob Smith', TRUE, 'active'),
('0827654323', 'M003', 'Carol White', TRUE, 'active');

-- Add sample public customer
INSERT INTO users (phone_number, m_number, name, is_employee, status) 
VALUES 
('0827654324', 'M004', 'David Brown', FALSE, 'active');

-- Add loyalty data
INSERT INTO loyalty (user_id, coffees_purchased, free_coffees_earned, points_balance)
VALUES 
(1, 25, 2, 5),  -- Alice: 25 coffees bought, earned 2 free, 5 towards next
(2, 15, 1, 5),  -- Bob: 15 coffees, 1 free earned, 5 towards next
(3, 10, 1, 0),  -- Carol: 10 coffees, 1 free earned, 0 towards next
(4, 8, 0, 8);   -- David: 8 coffees, no free yet, 8 towards next

-- Add sample transactions
INSERT INTO transactions (user_id, amount, payment_method, segment)
VALUES 
(1, 45.50, 'card', 'employee'),
(2, 30.00, 'card', 'employee'),
(4, 35.25, 'card', 'public');

-- Add inventory items
INSERT INTO inventory (item_name, category, current_stock, unit, low_stock_threshold)
VALUES 
('Green Beans - Ethiopian', 'beans', 45.5, 'kg', 10),
('Green Beans - Colombian', 'beans', 32.0, 'kg', 10),
('Roasted Beans - Light Roast', 'beans', 12.3, 'kg', 5),
('Whole Milk', 'dairy', 45.0, 'liters', 10),
('Oat Milk', 'dairy', 20.0, 'liters', 5),
('Sugar', 'supplies', 8.5, 'kg', 2),
('Coffee Cups (12oz)', 'supplies', 500, 'count', 100),
('Coffee Lids', 'supplies', 600, 'count', 150);

-- Add sample roasting batch
INSERT INTO roasting_batches (green_bean_type, quantity_kg, roast_date, roast_time_minutes, roast_level, roasted_quantity_kg, status)
VALUES 
('Ethiopian Yirgacheffe', 25.0, '2026-05-06', 18, 'Medium', 22.5, 'complete');

-- Add daily free coffee records
INSERT INTO daily_free_coffee (user_id, date, free_coffee_used)
VALUES 
(1, CURRENT_DATE, TRUE),
(2, CURRENT_DATE, FALSE),
(3, CURRENT_DATE, FALSE);
```

Paste this and press Enter. You should see:
```
INSERT 0 3
INSERT 0 1
...
```

✅ **Sample data added!**

---

## 🔍 Step 5: Verify Everything Works

Run these commands to check your data:

```sql
-- See all users
SELECT * FROM users;

-- See loyalty points
SELECT u.name, l.coffees_purchased, l.free_coffees_earned 
FROM users u 
JOIN loyalty l ON u.user_id = l.user_id;

-- See current inventory
SELECT item_name, current_stock, unit 
FROM inventory;

-- See recent transactions
SELECT * FROM transactions ORDER BY transaction_date DESC;
```

You should see your data displayed in tables.

✅ **Everything works!**

---

## 🚪 Step 6: Exit PostgreSQL

When you're done, type:

```sql
\q
```

You're back at your normal terminal/command prompt.

---

## 🔗 Step 7: Connect Your Web App Later

When you build your web app, you'll use this connection string:

```
postgresql://postgres:YOUR_PASSWORD@localhost:5432/favo_cafe
```

Replace `YOUR_PASSWORD` with the password you set during PostgreSQL installation.

**In your Node.js app, you'll use a library like `pg` or `sequelize` to connect:**

```javascript
// Example (we'll do this in actual code later)
const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  password: 'YOUR_PASSWORD',
  host: 'localhost',
  port: 5432,
  database: 'favo_cafe'
});
```

---

## 📚 Helpful PostgreSQL Commands

| Command | What it does |
|---------|------------|
| `\l` | List all databases |
| `\dt` | List all tables in current database |
| `\d table_name` | Show structure of a table |
| `SELECT * FROM table_name;` | View all data in a table |
| `\q` | Exit PostgreSQL |

---

## ❓ Troubleshooting

**Problem:** `psql: command not found`
- **Solution:** PostgreSQL not installed or not in your PATH. Download from postgresql.org

**Problem:** `password authentication failed`
- **Solution:** Check your password. You can reset it if you forgot it (Google it for your OS)

**Problem:** `database "favo_cafe" already exists`
- **Solution:** It's fine! Just run `\c favo_cafe` to connect to it

**Problem:** Table creation failed with error
- **Solution:** Copy-paste the SQL one section at a time. Check for typos.

---

## 🎯 Next Steps

1. ✅ Follow this guide to set up your database
2. ⏳ Wait for YOCO API information
3. 🎨 Start building the frontend (React app)
4. 🔌 Build backend API to connect frontend to database
5. 🔗 Integrate YOCO when you have API keys

---

## 📖 Want to Learn More?

- PostgreSQL Tutorial: https://www.postgresql.org/docs/
- SQL Tutorial: https://www.w3schools.com/sql/

You've got this! 🚀


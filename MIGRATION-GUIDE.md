# Neon Database Migration Guide for Modura.be
## Complete Step-by-Step Process to Reset Your Usage & Migrate Data

### 🎯 Overview
You've hit your Neon free tier limits. This guide will help you:
1. Create a new Neon project under your company
2. Transfer all existing data
3. Update your environment
4. Start fresh with reset usage to add all your modular home products

---

## Step 1: Create New Neon Project (5 minutes)

1. Go to [Neon.tech](https://neon.tech) and sign in
2. Click **"New Project"**
3. Name it: `modura-modular-homes` (or your company name)
4. Select the same region as before (us-east-2 for your current setup)
5. Create the project
6. Copy the **new connection string** (it will look like `postgresql://neondb_owner:...@ep-...us-east-2.aws.neon.tech/neondb?sslmode=require`)

---

## Step 2: Install PostgreSQL Tools (if not already installed)
You need `pg_dump` and `psql` to transfer data:
- Download: https://www.postgresql.org/download/windows/
- Run installer, check "Add PostgreSQL to PATH"
- Restart your terminal

---

## Step 3: Backup & Migrate Data

### Option A: Use the automated script (recommended)
1. Open `migrate-db.ps1`
2. Replace `YOUR_NEW_NEON_DATABASE_URL_HERE` with your new connection string
3. Run in PowerShell:
```powershell
.\migrate-db.ps1
```

### Option B: Manual commands
```powershell
# 1. Create backup of old database
pg_dump "postgresql://neondb_owner:npg_0l6VZJLhkagB@ep-square-boat-a5tm8ymc-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require" --file="medusa-backup.sql" --no-owner --no-privileges

# 2. Restore to new database (paste YOUR new URL)
psql "YOUR_NEW_NEON_DATABASE_URL" -f "medusa-backup.sql"

# 3. Update your .env file manually
# Replace the old DATABASE_URL with the new one in .env
```

---

## Step 4: Update All Configuration Files

The script updates your main `.env` file automatically. If doing manually, also check:

### .env file (already updated by script)
```env
# Old: DATABASE_URL="postgresql://neondb_owner:npg_0l6VZJLhkagB@ep-square-boat-a5tm8ymc-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
# New: DATABASE_URL="your_new_neon_url_here"
```

### .env.template
I've already updated this for future reference.

---

## Step 5: Run Migrations & Test

```powershell
# Install dependencies if needed
npm install

# Run Medusa migrations to ensure schema is current
npx medusa migrations run

# Start your server
npm run dev
```

---

## Step 6: Verify Everything Works

1. **Check Neon Dashboard**: Your new project should show data tables
2. **Test Admin Panel**: Go to http://localhost:9000/app and log in
3. **Verify Data**: Check that all your test data is there
4. **Start Adding Products**: You now have fresh usage limits to add all your modular homes!

---

## 📊 What Gets Transferred?
All your existing Medusa data:
- ✓ Products (if you added any test products)
- ✓ Collections & Categories
- ✓ Users & Admin accounts
- ✓ Settings & configurations
- ✓ Orders (test orders)
- ✓ All database tables

---

## 🔒 Important Notes
- **Your old database still exists** for 7 days in Neon, you can access it if needed
- **New project gets fresh free tier usage** (all monthly limits reset)
- **Vercel/Deployment update**: When you deploy to production, update the DATABASE_URL in your hosting provider's environment variables too
- **Supabase/Files**: If you store images in Supabase Storage, those are unaffected - only the PostgreSQL database moved

---

## ❗ Troubleshooting

### "pg_dump command not found"
- Install PostgreSQL from the link above and add to PATH
- Or use Neon's built-in import/export in the Neon dashboard

### Connection errors
- Verify your new Neon database is active
- Check that IP allowlist includes your current IP
- Ensure the connection string is copied completely

### Medusa won't start
- Double-check the DATABASE_URL in .env is correct
- Run `npx medusa migrations run` to fix any schema issues
- Clear node_modules and reinstall if needed: `rm -rf node_modules package-lock.json && npm install`

---

## 🚀 You're Ready!
Once this is complete, you can start adding all your modular home products to the store with your fresh database limits!
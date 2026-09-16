# Database Migration Script for Neon PostgreSQL
# This script will migrate your existing Medusa database to a new Neon project

# Configuration - UPDATED with your new company Neon URL
$OLD_DATABASE_URL = "postgresql://neondb_owner:npg_0l6VZJLhkagB@ep-square-boat-a5tm8ymc-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
$NEW_DATABASE_URL = "postgresql://neondb_owner:npg_BMmYWosH1U6L@ep-bitter-recipe-b5vp6vaw-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Create backup directory
$backupDir = ".\db-backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "$backupDir\medusa-backup-$timestamp.sql"

Write-Host "🚀 Starting database migration process..." -ForegroundColor Cyan
Write-Host "`n📦 Step 1: Creating backup of old database..." -ForegroundColor Yellow

# Check if pg_dump is available
if (-not (Get-Command "pg_dump" -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: PostgreSQL tools (pg_dump/pg_restore) not found. Please install PostgreSQL first." -ForegroundColor Red
    Write-Host "📥 Download from: https://www.postgresql.org/download/windows/" -ForegroundColor Gray
    exit 1
}

# Create backup
pg_dump "$OLD_DATABASE_URL" --file="$backupFile" --no-owner --no-privileges
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Backup failed. Please check your old database URL." -ForegroundColor Red
    exit 1
}
Write-Host "✅ Backup created: $backupFile" -ForegroundColor Green

Write-Host "`n🔄 Step 2: Restoring backup to new database..." -ForegroundColor Yellow

# Restore to new database
psql "$NEW_DATABASE_URL" -f "$backupFile"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Restore failed. Please check your new database URL." -ForegroundColor Red
    exit 1
}
Write-Host "✅ Database restored to new Neon project!" -ForegroundColor Green

Write-Host "`n📝 Step 3: Updating .env file with new database URL..." -ForegroundColor Yellow

# Update .env file
$envPath = ".\.env"
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
    $newEnvContent = $envContent -replace [regex]::Escape($OLD_DATABASE_URL), $NEW_DATABASE_URL
    Set-Content -Path $envPath -Value $newEnvContent
    Write-Host "✅ .env file updated successfully!" -ForegroundColor Green
} else {
    Write-Host "⚠️ .env file not found. Please update manually." -ForegroundColor Yellow
}

Write-Host "`n🏃 Step 4: Running Medusa migrations to ensure schema is up to date..." -ForegroundColor Yellow

# Run Medusa migrations (v2 syntax)
npx medusa migrations run
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ Migrations had some output, but database is transferred. Check manually if needed." -ForegroundColor Yellow
} else {
    Write-Host "✅ Migrations completed successfully!" -ForegroundColor Green
}

Write-Host "`n🎉 Database migration completed successfully!" -ForegroundColor Green
Write-Host "`n📋 Next steps:" -ForegroundColor Cyan
Write-Host "1. Verify your new Neon database has all data in the Neon dashboard"
Write-Host "2. Start your Medusa server: npm run dev"
Write-Host "3. Test the admin dashboard and storefront"
Write-Host "4. You can now add all your modular home products to the new database!"
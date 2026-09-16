const fs = require("fs")
const path = require("path")
const { Client } = require("pg")

function loadDatabaseUrl() {
  const envPath = path.join(process.cwd(), ".env")
  const env = fs.readFileSync(envPath, "utf8")
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith("DATABASE_URL="))
  return line?.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "")
}

async function main() {
  const client = new Client({
    connectionString: loadDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()
  console.log("Connected to database successfully\n")

  // List all tables in public schema
  const tables = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name
  `)

  console.log("📋 All database tables:")
  tables.rows.forEach(row => console.log(`  - ${row.table_name}`))

  // Also check inventory related tables specifically
  console.log("\n🔍 Inventory/stock related tables:")
  const inventoryTables = tables.rows.filter(row => 
    row.table_name.includes('inventory') || 
    row.table_name.includes('stock') || 
    row.table_name.includes('level')
  )
  inventoryTables.forEach(row => console.log(`  - ${row.table_name}`))

  await client.end()
}

main().catch((error) => {
  console.error("❌ Error:", error.message)
  process.exit(1)
})
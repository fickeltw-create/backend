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

  // Get sales channel UUID
  const salesChannels = await client.query(`
    SELECT id, name FROM sales_channel WHERE deleted_at IS NULL
  `)
  // Get stock location UUID
  const stockLocations = await client.query(`
    SELECT id, name FROM stock_location WHERE deleted_at IS NULL
  `)

  console.log("✅ YOUR PERMANENT UUIDS FOR ALL FUTURE IMPORTS:")
  console.log("\nSales Channel:")
  salesChannels.rows.forEach(s => console.log(`  Name: ${s.name} | UUID: ${s.id}`))
  console.log("\nStock Location:")
  stockLocations.rows.forEach(l => console.log(`  Name: ${l.name} | UUID: ${l.id}`))

  console.log("\n📝 Copy these into your AI prompt - they'll never change!")
  await client.end()
}

main().catch(err => console.error(err))
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

  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE '%sales_channel%'
    ORDER BY table_name
  `)

  console.log("Sales-channel tables:")
  console.log(tables.rows.map(({ table_name: tableName }) => tableName).join("\n"))

  for (const { table_name: tableName } of tables.rows) {
    const columns = await client.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `,
      [tableName]
    )
    console.log(`\n${tableName}:`)
    console.log(columns.rows.map(({ column_name: columnName }) => columnName).join(", "))
  }

  for (const tableName of ["sales_channel_stock_location", "stock_location_sales_channel"]) {
    const deletedFilter = tableName === "sales_channel_stock_location"
      ? "AND link.deleted_at IS NULL"
      : ""
    const orphaned = await client.query(`
      SELECT link.id, link.stock_location_id, link.sales_channel_id
      FROM ${tableName} link
      LEFT JOIN sales_channel channel ON channel.id = link.sales_channel_id
        AND channel.deleted_at IS NULL
      WHERE channel.id IS NULL
        ${deletedFilter}
    `)
    console.log(`\nOrphaned links in ${tableName}:`)
    console.log(JSON.stringify(orphaned.rows, null, 2))
  }

  await client.end()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})

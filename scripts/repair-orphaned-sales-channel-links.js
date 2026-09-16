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

  try {
    await client.query("BEGIN")

    const salesChannelLocationLinks = await client.query(`
      DELETE FROM sales_channel_stock_location link
      WHERE NOT EXISTS (
        SELECT 1
        FROM sales_channel channel
        WHERE channel.id = link.sales_channel_id
          AND channel.deleted_at IS NULL
      )
      RETURNING id, stock_location_id, sales_channel_id
    `)

    const locationSalesChannelLinks = await client.query(`
      DELETE FROM stock_location_sales_channel link
      WHERE NOT EXISTS (
        SELECT 1
        FROM sales_channel channel
        WHERE channel.id = link.sales_channel_id
          AND channel.deleted_at IS NULL
      )
      RETURNING id, stock_location_id, sales_channel_id
    `)

    await client.query("COMMIT")

    console.log("Removed from sales_channel_stock_location:")
    console.log(JSON.stringify(salesChannelLocationLinks.rows, null, 2))
    console.log("Removed from stock_location_sales_channel:")
    console.log(JSON.stringify(locationSalesChannelLinks.rows, null, 2))
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})

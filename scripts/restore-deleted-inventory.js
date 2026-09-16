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
    const inventoryItems = await client.query(`
      UPDATE inventory_item
      SET deleted_at = NULL
      WHERE deleted_at IS NOT NULL
      RETURNING id
    `)
    const inventoryLevels = await client.query(`
      UPDATE inventory_level level
      SET deleted_at = NULL
      WHERE level.deleted_at IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM inventory_item item
          WHERE item.id = level.inventory_item_id
            AND item.deleted_at IS NULL
        )
      RETURNING id
    `)
    await client.query("COMMIT")
    console.log("Restored inventory items:", inventoryItems.rowCount)
    console.log("Restored inventory levels:", inventoryLevels.rowCount)
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

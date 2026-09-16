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

    const statements = [
      ["duplicate handles", `
        UPDATE product product_record
        SET handle = product_record.handle || '-restored-' || RIGHT(product_record.id, 8)
        WHERE product_record.deleted_at IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM product earlier_record
            WHERE earlier_record.handle = product_record.handle
              AND earlier_record.id < product_record.id
          )
      `],
      ["products", `UPDATE product SET deleted_at = NULL WHERE deleted_at IS NOT NULL`],
      ["variants", `UPDATE product_variant SET deleted_at = NULL WHERE deleted_at IS NOT NULL`],
      ["options", `UPDATE product_option SET deleted_at = NULL WHERE deleted_at IS NOT NULL`],
      ["option values", `UPDATE product_option_value SET deleted_at = NULL WHERE deleted_at IS NOT NULL`],
      ["product-option links", `UPDATE product_product_option SET deleted_at = NULL WHERE deleted_at IS NOT NULL`],
      ["option-value links", `UPDATE product_product_option_value SET deleted_at = NULL WHERE deleted_at IS NOT NULL`],
      ["variant inventory links", `UPDATE product_variant_inventory_item SET deleted_at = NULL WHERE deleted_at IS NOT NULL`],
      ["variant price links", `UPDATE product_variant_price_set SET deleted_at = NULL WHERE deleted_at IS NOT NULL`],
      ["variant image links", `UPDATE product_variant_product_image SET deleted_at = NULL WHERE deleted_at IS NOT NULL`],
      ["sales-channel links", `
        UPDATE product_sales_channel link
        SET deleted_at = NULL
        WHERE link.deleted_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM product product_record
            WHERE product_record.id = link.product_id
              AND product_record.deleted_at IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM sales_channel channel
            WHERE channel.id = link.sales_channel_id
              AND channel.deleted_at IS NULL
          )
      `],
      ["shipping-profile links", `
        UPDATE product_shipping_profile link
        SET deleted_at = NULL
        WHERE link.deleted_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM product product_record
            WHERE product_record.id = link.product_id
              AND product_record.deleted_at IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM shipping_profile profile
            WHERE profile.id = link.shipping_profile_id
              AND profile.deleted_at IS NULL
          )
      `],
    ]

    for (const [label, sql] of statements) {
      const result = await client.query(sql)
      console.log(`${label}: ${result.rowCount}`)
    }

    await client.query("COMMIT")
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

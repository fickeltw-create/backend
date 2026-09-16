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

  // 1. Get default sales channel
  const salesChannelsResult = await client.query(`
    SELECT id, name
    FROM sales_channel
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `)

  if (salesChannelsResult.rows.length === 0) {
    console.log("❌ No sales channels found!")
    await client.end()
    return
  }
  const defaultSalesChannel = salesChannelsResult.rows[0]
  console.log(`📦 Default Sales Channel: ${defaultSalesChannel.name} (${defaultSalesChannel.id})\n`)

  // 2. Get default location (Medusa uses stock_location not location)
  const locationsResult = await client.query(`
    SELECT id, name
    FROM stock_location
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `)

  if (locationsResult.rows.length === 0) {
    console.log("❌ No locations found!")
    await client.end()
    return
  }
  const defaultLocation = locationsResult.rows[0]
  console.log(`📍 Default Location: ${defaultLocation.name} (${defaultLocation.id})\n`)

  // 3. Find all active products
  const allProducts = await client.query(`
    SELECT id, title, handle
    FROM product
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
  `)

  console.log(`🔍 Found ${allProducts.rows.length} active products to process\n`)

  for (const product of allProducts.rows) {
    console.log(`\n--- Processing: ${product.title} (${product.id}) ---`)

    // 4. Delete all invalid sales channel links for this product
    const deleteInvalidQuery = `
      DELETE FROM product_sales_channel
      WHERE product_id = $1
        AND deleted_at IS NULL
        AND sales_channel_id NOT IN (
          SELECT id FROM sales_channel WHERE deleted_at IS NULL
        )
    `
    const deleteResult = await client.query(deleteInvalidQuery, [product.id])
    if (deleteResult.rowCount > 0) {
      console.log(`  🗑️  Deleted ${deleteResult.rowCount} invalid sales channel links`)
    }

    // 5. Check if product is already linked to default sales channel
    const existingLink = await client.query(`
      SELECT id FROM product_sales_channel
      WHERE product_id = $1
        AND sales_channel_id = $2
        AND deleted_at IS NULL
    `, [product.id, defaultSalesChannel.id])

    if (existingLink.rows.length === 0) {
      // Add to default sales channel
      await client.query(`
        INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
      `, [product.id, defaultSalesChannel.id])
      console.log(`  ✅ Added to default sales channel`)
    } else {
      console.log(`  ✓ Already in default sales channel`)
    }

    // 6. Get all variants for this product
    const variants = await client.query(`
      SELECT id, sku, title
      FROM product_variant
      WHERE product_id = $1
        AND deleted_at IS NULL
    `, [product.id])

    for (const variant of variants.rows) {
      console.log(`    🎯 Variant: ${variant.title} (${variant.sku || 'no sku'})`)

      // 7. Get inventory items for this variant (Medusa v2 uses inventory_level)
      const inventoryItems = await client.query(`
        SELECT 
          ii.id as inventory_item_id,
          il.id as level_id,
          il.stocked_quantity
        FROM product_variant_inventory_item pvi
        JOIN inventory_item ii ON ii.id = pvi.inventory_item_id
          AND ii.deleted_at IS NULL
        LEFT JOIN inventory_level il ON il.inventory_item_id = ii.id
          AND il.location_id = $2
          AND il.deleted_at IS NULL
        WHERE pvi.variant_id = $1
          AND pvi.deleted_at IS NULL
      `, [variant.id, defaultLocation.id])

      if (inventoryItems.rows.length > 0) {
        for (const item of inventoryItems.rows) {
          // Update inventory level to 100 units if it doesn't exist or needs updating
          if (item.level_id) {
            // Update existing inventory level
            await client.query(`
              UPDATE inventory_level
              SET stocked_quantity = 100, updated_at = NOW()
              WHERE id = $1
            `, [item.level_id])
            console.log(`      📊 Updated inventory to 100 units`)
          } else {
            // Create new inventory level with 100 units
            await client.query(`
              INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, created_at, updated_at)
              VALUES (gen_random_uuid(), $1, $2, 100, NOW(), NOW())
            `, [item.inventory_item_id, defaultLocation.id])
            console.log(`      ➕ Created inventory with 100 units`)
          }
        }
      } else {
        // If no inventory item exists, create it
        console.log(`      ⚠️  No inventory item found, creating new inventory record...`)
        // Create inventory item
        const newInventoryItem = await client.query(`
          INSERT INTO inventory_item (id, created_at, updated_at)
          VALUES (gen_random_uuid(), NOW(), NOW())
          RETURNING id
        `, [])
        
        // Link variant to inventory item
        await client.query(`
          INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, created_at, updated_at)
          VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
        `, [variant.id, newInventoryItem.rows[0].id])
        
        // Create inventory level with 100 units
        await client.query(`
          INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, created_at, updated_at)
          VALUES (gen_random_uuid(), $1, $2, 100, NOW(), NOW())
        `, [newInventoryItem.rows[0].id, defaultLocation.id])
        console.log(`      ✅ Created inventory with 100 units in default location`)
      }
    }
  }

  console.log("\n🎉 All products have been processed successfully!")
  console.log("\n✅ Every product:")
  console.log("   - Is linked to the default sales channel (invalid links removed)")
  console.log("   - Has exactly 100 units of inventory available in the default location")

  await client.end()
}

main().catch((error) => {
  console.error("❌ Error:", error.message)
  console.error(error.stack)
  process.exit(1)
})
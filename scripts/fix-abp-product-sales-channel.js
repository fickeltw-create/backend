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
  console.log("Connected to database successfully")

  // 1. Find the problematic product
  const productResult = await client.query(`
    SELECT id, title, handle, created_at
    FROM product
    WHERE title ILIKE '%ABP Maison Conteneur Extensible Moderne%'
      AND deleted_at IS NULL
  `)

  if (productResult.rows.length === 0) {
    console.log("Product not found. Searching for similar titles...")
    const similarProducts = await client.query(`
      SELECT id, title, handle
      FROM product
      WHERE title ILIKE '%maison%conteneur%'
        AND deleted_at IS NULL
    `)
    console.log("Similar products found:", similarProducts.rows)
    await client.end()
    return
  }

  const product = productResult.rows[0]
  console.log("\nFound problematic product:")
  console.log(JSON.stringify(product, null, 2))

  // 2. Get all valid sales channels
  const salesChannelsResult = await client.query(`
    SELECT id, name, created_at
    FROM sales_channel
    WHERE deleted_at IS NULL
  `)

  console.log("\nAvailable sales channels:")
  console.log(salesChannelsResult.rows.map(sc => `${sc.name} (${sc.id})`).join("\n"))

  if (salesChannelsResult.rows.length === 0) {
    console.log("No sales channels found!")
    await client.end()
    return
  }

  // 3. Check current sales channel links for this product
  const currentLinksResult = await client.query(`
    SELECT psc.id, psc.product_id, psc.sales_channel_id, sc.name, sc.id as sc_id
    FROM product_sales_channel psc
    LEFT JOIN sales_channel sc ON sc.id = psc.sales_channel_id
    WHERE psc.product_id = $1
      AND psc.deleted_at IS NULL
  `, [product.id])

  console.log("\nCurrent sales channel links for this product:")
  console.log(currentLinksResult.rows)

  // 4. Find null/invalid links that are causing the error
  const invalidLinks = currentLinksResult.rows.filter(row => row.sc_id === null)
  console.log(`\nFound ${invalidLinks.length} invalid sales channel links that need fixing`)

  // 5. Delete invalid links
  if (invalidLinks.length > 0) {
    for (const link of invalidLinks) {
      await client.query(`
        DELETE FROM product_sales_channel
        WHERE id = $1
      `, [link.id])
      console.log(`Deleted invalid link: ${link.id}`)
    }
  }

  // 6. Add the product to the default sales channel (first available one)
  const defaultChannel = salesChannelsResult.rows[0]
  const existingValidLink = currentLinksResult.rows.find(row => row.sales_channel_id === defaultChannel.id)
  
  if (!existingValidLink) {
    await client.query(`
      INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
    `, [product.id, defaultChannel.id])
    console.log(`\nAdded product to default sales channel: ${defaultChannel.name} (${defaultChannel.id})`)
  } else {
    console.log(`\nProduct is already linked to default sales channel: ${defaultChannel.name}`)
  }

  // 7. Verify the fix
  const verifyLinks = await client.query(`
    SELECT psc.id, sc.name, sc.id as valid_sc_id
    FROM product_sales_channel psc
    JOIN sales_channel sc ON sc.id = psc.sales_channel_id
    WHERE psc.product_id = $1
      AND psc.deleted_at IS NULL
      AND sc.deleted_at IS NULL
  `, [product.id])

  console.log("\n✅ Final verified sales channel links after fix:")
  console.log(verifyLinks.rows)
  console.log("\nThe error 'Cannot read properties of null (reading 'id')' should now be resolved!")

  await client.end()
}

main().catch((error) => {
  console.error("Error:", error.message)
  process.exit(1)
})
const fs = require("fs")
const path = require("path")
const { Client } = require("pg")
const bcrypt = require("bcryptjs")

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

  // 1. List all admin users
  const users = await client.query(`
    SELECT id, email, first_name, last_name, metadata, created_at
    FROM "user"
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
  `)

  console.log(`📋 Found ${users.rows.length} admin users:`)
  users.rows.forEach(u => console.log(`  - ${u.first_name} ${u.last_name} (${u.email}) | ID: ${u.id}`))

  if (users.rows.length === 0) {
    console.log("\n❌ No admin users found. Creating new admin user...")
    // Create new admin user
    const hashedPassword = await bcrypt.hash("admin@medusa123", 10)
    const newUser = await client.query(`
      INSERT INTO "user" (
        id, email, password_hash, first_name, last_name, 
        role, created_at, updated_at, metadata
      ) VALUES (
        gen_random_uuid(), 'admin@medusa.local', $1, 'Admin', 'User',
        'admin', NOW(), NOW(), '{}'
      ) RETURNING id, email
    `, [hashedPassword])
    
    console.log(`\n✅ Created new admin user:`)
    console.log(`   Email: admin@medusa.local`)
    console.log(`   Password: admin@medusa123`)
  } else {
    // Reset password for the first admin user
    const user = users.rows[0]
    const hashedPassword = await bcrypt.hash("Modura26*", 10)
    
    await client.query(`
      UPDATE "user"
      SET email = $1, password_hash = $2, updated_at = NOW()
      WHERE id = $3
    `, ["Info@modura.be", hashedPassword, user.id])
    
    console.log(`\n✅ Reset password for admin user:`)
    console.log(`   Email: Info@modura.be`)
    console.log(`   New Password: Modura26*`)
  }

  // 2. Clear any existing sessions to force fresh login
  const deletedSessions = await client.query(`
    DELETE FROM auth_session
    WHERE deleted_at IS NULL
  `)
  console.log(`\n🗑️  Cleared ${deletedSessions.rowCount} existing sessions`)

  console.log("\n🎉 You can now log in with the credentials above!")
  console.log("\n💡 If you still have issues, clear your browser cache and cookies for localhost:9000")

  await client.end()
}

main().catch((error) => {
  console.error("❌ Error:", error.message)
  console.error(error.stack)
  process.exit(1)
})
const fs = require('fs');
const { Client } = require('pg');

function readDatabaseUrl() {
  const envPath = require('path').join(process.cwd(), '.env');
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0 && trimmed.slice(0, idx) === 'DATABASE_URL') {
      return trimmed.slice(idx + 1).trim().replace(/^"|"$/g, '');
    }
  }

  return process.env.DATABASE_URL;
}

(async () => {
  const connectionString = readDatabaseUrl();

  if (!connectionString) {
    console.error('DATABASE_URL not found in .env or environment');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const update = await client.query(`
      UPDATE stock_location
      SET name = COALESCE(name, 'Location ' || id::text)
      WHERE name IS NULL OR name = ''
    `);

    const remaining = await client.query(`
      SELECT id, name
      FROM stock_location
      WHERE name IS NULL OR name = ''
      ORDER BY id
    `);

    console.log('Updated rows:', update.rowCount);
    console.log('Remaining empty names:', JSON.stringify(remaining.rows, null, 2));
  } catch (error) {
    console.error('Database cleanup failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();

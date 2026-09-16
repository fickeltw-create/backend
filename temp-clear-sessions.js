const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadDatabaseUrl() {
  const envPath = path.join(process.cwd(), '.env');
  const env = fs.readFileSync(envPath, 'utf8');
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('DATABASE_URL='));
  return line?.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
}

async function clearSessions() {
  const client = new Client({
    connectionString: loadDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  
  // First list all tables to confirm the correct session table
  const tables = await client.query(
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name
  );
  
  console.log('Found tables containing "session":');
  tables.rows.filter(r => r.table_name.includes('session')).forEach(r => console.log('  -', r.table_name));
  
  // Now clear all session records
  const result = await client.query('DELETE FROM auth_user_session WHERE deleted_at IS NULL');
  console.log('\n✅ Cleared ' + result.rowCount + ' old user sessions');
  await client.end();
}

clearSessions();

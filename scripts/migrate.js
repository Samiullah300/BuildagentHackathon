const { Pool } = require('pg');
const fs = require('fs');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const sql = fs.readFileSync(process.argv[2], 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='commitments' ORDER BY ordinal_position"
  );
  console.log('OK columns: ' + rows.map(r => r.column_name).join(', '));
  process.exit(0);
})().catch(e => { console.error('FAIL ' + e.message); process.exit(1); });

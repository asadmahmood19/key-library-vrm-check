import { ensureSchema, pool } from './db';

async function main() {
  await ensureSchema();
  console.log('Database schema migrated successfully.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await pool.end();
  process.exit(1);
});

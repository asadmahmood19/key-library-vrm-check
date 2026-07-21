import { pool } from '../src/db';

async function main() {
  await pool.query('DELETE FROM lookups');
  await pool.query('DELETE FROM vehicle_cache');
  await pool.query('DELETE FROM customers');
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM customers) AS customers,
      (SELECT COUNT(*)::int FROM lookups) AS lookups,
      (SELECT COUNT(*)::int FROM vehicle_cache) AS cache
  `);
  console.log('Cleared. Counts:', r.rows[0]);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});

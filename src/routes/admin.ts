import { Router } from 'express';
import { config } from '../config';
import { requireAdmin } from '../middleware/adminAuth';
import { query } from '../db';
import {
  adjustCredits,
  listCustomers,
  countCustomers,
  listCustomerIds,
  setCredits,
  setCreditsBulk,
  setCreditsBulkUpdates,
  setCreditsByEmail,
  upsertCustomer,
} from '../services/credits';
import { listLookups, countLookups } from '../services/lookup';

export const adminRouter = Router();

adminRouter.post('/login', (req, res) => {
  const password = String(req.body.password || '');
  if (password !== config.adminPassword) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }
  (req.session as { admin?: boolean }).admin = true;
  res.json({ ok: true });
});

adminRouter.post('/logout', (req, res) => {
  req.session = null as unknown as typeof req.session;
  res.json({ ok: true });
});

adminRouter.get('/session', (req, res) => {
  const ok = !!(req.session && (req.session as { admin?: boolean }).admin);
  res.json({ authenticated: ok });
});

adminRouter.use(requireAdmin);

adminRouter.get('/stats', async (_req, res) => {
  try {
    const [lookups, uniqueVrms, cacheHits, customersWithCredits, cacheCount] = await Promise.all([
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM lookups`),
      query<{ count: string }>(`SELECT COUNT(DISTINCT vrm)::text AS count FROM lookups`),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM lookups WHERE was_cached = TRUE`
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM customers WHERE credits > 0`
      ),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM vehicle_cache`),
    ]);

    const totalLookups = Number(lookups.rows[0]?.count || 0);
    const cachedLookups = Number(cacheHits.rows[0]?.count || 0);

    res.json({
      totalLookups,
      uniqueVrms: Number(uniqueVrms.rows[0]?.count || 0),
      cacheHitRate: totalLookups === 0 ? 0 : Math.round((cachedLookups / totalLookups) * 1000) / 10,
      customersWithCredits: Number(customersWithCredits.rows[0]?.count || 0),
      cachedRegistrations: Number(cacheCount.rows[0]?.count || 0),
    });
  } catch (err) {
    console.error('GET /api/admin/stats', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

adminRouter.get('/customers', async (req, res) => {
  try {
    const search = req.query.search ? String(req.query.search) : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const [customers, total] = await Promise.all([
      listCustomers(search, limit, offset),
      countCustomers(search),
    ]);
    res.json({ customers, total, limit, offset });
  } catch (err) {
    console.error('GET /api/admin/customers', err);
    res.status(500).json({ error: 'Failed to list customers' });
  }
});

adminRouter.post('/customers', async (req, res) => {
  try {
    const email = req.body.email ? String(req.body.email).trim() : '';
    const credits = Number(req.body.credits);

    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }
    if (!Number.isFinite(credits) || credits < 0) {
      res.status(400).json({ error: 'credits must be a non-negative number' });
      return;
    }

    const customer = await setCreditsByEmail(email, Math.floor(credits));
    res.json({ customer });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set credits';
    const status = message.includes('No customer found') ? 404 : 500;
    if (status === 500) console.error('POST /api/admin/customers', err);
    res.status(status).json({ error: message });
  }
});

adminRouter.get('/customers/ids', async (req, res) => {
  try {
    const search = req.query.search ? String(req.query.search) : undefined;
    const ids = await listCustomerIds(search);
    res.json({ ids, total: ids.length });
  } catch (err) {
    console.error('GET /api/admin/customers/ids', err);
    res.status(500).json({ error: 'Failed to list customer ids' });
  }
});

adminRouter.patch('/customers/credits/bulk', async (req, res) => {
  try {
    const updates = Array.isArray(req.body.updates) ? req.body.updates : null;
    if (updates) {
      const cleaned = updates.map((u: { customer_id?: unknown; credits?: unknown }) => ({
        customer_id: String(u.customer_id || ''),
        credits: Number(u.credits),
      }));
      if (!cleaned.length) {
        res.status(400).json({ error: 'Select at least one customer' });
        return;
      }
      for (const row of cleaned) {
        if (!row.customer_id || !Number.isFinite(row.credits) || row.credits < 0) {
          res.status(400).json({ error: 'Each selected row needs a valid credits number (0 or more)' });
          return;
        }
      }
      const updated = await setCreditsBulkUpdates(cleaned);
      res.json({ ok: true, updated });
      return;
    }

    const credits = Number(req.body.credits);
    const customerIds = Array.isArray(req.body.customer_ids)
      ? req.body.customer_ids.map((id: unknown) => String(id))
      : [];

    if (!Number.isFinite(credits) || credits < 0) {
      res.status(400).json({ error: 'credits must be a non-negative number' });
      return;
    }
    if (!customerIds.length) {
      res.status(400).json({ error: 'Select at least one customer' });
      return;
    }

    const updated = await setCreditsBulk(customerIds, Math.floor(credits));
    res.json({ ok: true, updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to bulk update credits';
    res.status(400).json({ error: message });
  }
});

adminRouter.patch('/customers/:customerId/credits', async (req, res) => {
  try {
    const customerId = req.params.customerId;
    const { credits, delta, email } = req.body as {
      credits?: number;
      delta?: number;
      email?: string;
    };

    if (typeof credits === 'number') {
      const customer = await setCredits(customerId, Math.floor(credits), email);
      res.json({ customer });
      return;
    }

    if (typeof delta === 'number') {
      await upsertCustomer(customerId, email);
      const customer = await adjustCredits(customerId, Math.floor(delta));
      res.json({ customer });
      return;
    }

    res.status(400).json({ error: 'Provide credits or delta' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update credits';
    res.status(400).json({ error: message });
  }
});

adminRouter.get('/lookups', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const [lookups, total] = await Promise.all([
      listLookups(limit, offset),
      countLookups(),
    ]);
    res.json({
      lookups: lookups.map((row) => ({
        id: String(row.id),
        shopify_customer_id: row.shopify_customer_id,
        name: row.name || null,
        email: row.email || null,
        company: row.company || null,
        vrm: row.vrm,
        was_cached: row.was_cached,
        created_at: row.created_at,
        make: row.vehicle?.make || null,
        model: row.vehicle?.model || null,
        year: row.vehicle?.year || null,
        vehicle: row.vehicle,
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('GET /api/admin/lookups', err);
    res.status(500).json({ error: 'Failed to list lookups' });
  }
});

adminRouter.get('/cache', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);
    const { rows } = await query<{
      vrm: string;
      fetched_at: Date;
      age_days: number;
    }>(
      `SELECT vrm, fetched_at,
              EXTRACT(EPOCH FROM (NOW() - fetched_at)) / 86400 AS age_days
       FROM vehicle_cache
       ORDER BY fetched_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({
      cache: rows.map((r) => ({
        vrm: r.vrm,
        fetched_at: r.fetched_at,
        age_days: Math.round(Number(r.age_days) * 10) / 10,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/cache', err);
    res.status(500).json({ error: 'Failed to list cache' });
  }
});

adminRouter.delete('/cache/:vrm', async (req, res) => {
  try {
    const vrm = String(req.params.vrm || '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
    await query(`DELETE FROM vehicle_cache WHERE vrm = $1`, [vrm]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/cache', err);
    res.status(500).json({ error: 'Failed to purge cache entry' });
  }
});

adminRouter.get('/export/:type', async (req, res) => {
  try {
    const type = req.params.type;
    if (type === 'customers') {
      const { rows } = await query<{
        shopify_customer_id: string;
        email: string | null;
        credits: number;
        created_at: Date;
        updated_at: Date;
      }>(`SELECT shopify_customer_id, email, name, company, credits, created_at, updated_at FROM customers ORDER BY updated_at DESC`);
      const header = 'shopify_customer_id,email,name,company,credits,created_at,updated_at\n';
      const body = rows
        .map((r) =>
          [
            r.shopify_customer_id,
            csvEscape(r.email || ''),
            csvEscape((r as { name?: string | null }).name || ''),
            csvEscape((r as { company?: string | null }).company || ''),
            r.credits,
            r.created_at.toISOString(),
            r.updated_at.toISOString(),
          ].join(',')
        )
        .join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
      res.send(header + body);
      return;
    }

    if (type === 'lookups') {
      const lookups = await listLookups(50000, 0);
      const header = [
        'date',
        'name',
        'email',
        'vrm',
        'vin',
        'make',
        'model',
        'year',
        'model_generation',
        'model_series',
        'model_code',
        'model_start_date',
        'model_end_date',
        'vehicle_type',
        'tax_status',
        'tax_due_date',
        'mot_status',
        'mot_expiry_date',
        'engine_model_code',
        'body_style',
        'country_of_origin',
        'colour',
        'date_first_registered',
        'engine_capacity',
        'engine_manufacturer',
        'number_of_gears',
        'fuel_type',
        'maximum_power',
        'number_of_doors',
        'transmission',
        'euro_status',
        'latest_v5_issue_date',
      ].join(',');
      const body = lookups
        .map((r) => {
          const v = r.vehicle;
          return [
            csvCell(r.created_at.toISOString().slice(0, 10)),
            csvCell(r.name),
            csvCell(r.email),
            csvCell(v?.vrm || r.vrm),
            csvCell(v?.vin || v?.vinLast5),
            csvCell(v?.make),
            csvCell(v?.model),
            csvCell(v?.year),
            csvCell(v?.modelGeneration),
            csvCell(v?.modelSeries),
            csvCell(v?.modelCode),
            csvCell(v?.modelStartDate),
            csvCell(v?.modelEndDate),
            csvCell(v?.vehicleType),
            csvCell(v?.taxStatus),
            csvCell(v?.taxDueDate),
            csvCell(v?.motStatus),
            csvCell(v?.motExpiryDate),
            csvCell(v?.engineModelCode),
            csvCell(v?.body),
            csvCell(v?.countryOfOrigin),
            csvCell(v?.colour),
            csvCell(v?.dateFirstRegistered),
            csvCell(v?.engineCc),
            csvCell(v?.engineManufacturer),
            csvCell(v?.numberOfGears),
            csvCell(v?.fuel),
            csvCell(v?.maximumPower),
            csvCell(v?.numberOfDoors),
            csvCell(v?.transmission),
            csvCell(v?.euroStatus),
            csvCell(v?.latestV5IssueDate),
          ].join(',');
        })
        .join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="lookups.csv"');
      res.send(header + '\n' + body);
      return;
    }

    res.status(400).json({ error: 'Unknown export type. Use customers or lookups.' });
  } catch (err) {
    console.error('GET /api/admin/export', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvCell(value: unknown): string {
  if (value == null || value === '') return '';
  return csvEscape(String(value));
}

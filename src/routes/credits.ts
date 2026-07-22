import { Router } from 'express';
import { config } from '../config';
import { upsertCustomer } from '../services/credits';
import { recentLookups } from '../services/lookup';

export const creditsRouter = Router();

creditsRouter.get('/', async (req, res) => {
  try {
    const customerId = String(req.query.customer_id || '').trim();
    const email = req.query.email ? String(req.query.email).trim() : null;
    const name = req.query.name ? String(req.query.name).trim() : null;
    const company = req.query.company ? String(req.query.company).trim() : null;

    if (!customerId) {
      res.status(400).json({ error: 'customer_id is required' });
      return;
    }

    const customer = await upsertCustomer(customerId, { email, name, company });
    const history = await recentLookups(customerId, 10);

    res.json({
      customerId: customer.shopify_customer_id,
      email: customer.email,
      name: customer.name,
      company: customer.company,
      credits: customer.credits,
      buyCreditsUrl: config.buyCreditsUrl,
      history,
    });
  } catch (err) {
    console.error('GET /api/credits', err);
    res.status(500).json({ error: 'Failed to load credits' });
  }
});

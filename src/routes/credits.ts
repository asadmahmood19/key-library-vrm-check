import { Router } from 'express';
import { config } from '../config';
import { upsertCustomer, getCustomer } from '../services/credits';
import { recentLookups } from '../services/lookup';

export const creditsRouter = Router();

creditsRouter.get('/', async (req, res) => {
  try {
    const customerId = String(req.query.customer_id || '').trim();
    const email = req.query.email ? String(req.query.email).trim() : null;

    if (!customerId) {
      res.status(400).json({ error: 'customer_id is required' });
      return;
    }

    const customer = await upsertCustomer(customerId, email);
    const history = await recentLookups(customerId, 8);

    res.json({
      customerId: customer.shopify_customer_id,
      email: customer.email,
      credits: customer.credits,
      buyCreditsUrl: config.buyCreditsUrl,
      history,
    });
  } catch (err) {
    console.error('GET /api/credits', err);
    res.status(500).json({ error: 'Failed to load credits' });
  }
});

creditsRouter.get('/:customerId', async (req, res) => {
  try {
    const customer = await getCustomer(req.params.customerId);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json(customer);
  } catch (err) {
    console.error('GET /api/credits/:id', err);
    res.status(500).json({ error: 'Failed to load customer' });
  }
});

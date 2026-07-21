import { Router } from 'express';
import { LookupError, performLookup } from '../services/lookup';

export const lookupRouter = Router();

lookupRouter.post('/', async (req, res) => {
  try {
    const customerId = String(req.body.customer_id || req.query.customer_id || '').trim();
    const email = req.body.email ? String(req.body.email).trim() : null;
    const vrm = String(req.body.vrm || '').trim();

    if (!customerId) {
      res.status(400).json({ error: 'customer_id is required' });
      return;
    }
    if (!vrm) {
      res.status(400).json({ error: 'vrm is required' });
      return;
    }

    const result = await performLookup(customerId, vrm, email);
    res.json(result);
  } catch (err) {
    if (err instanceof LookupError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('POST /api/lookup', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

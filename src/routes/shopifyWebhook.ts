import { Router, Request, Response } from 'express';
import { config } from '../config';
import { query } from '../db';
import { applyOrderSpend } from '../services/credits';

export const shopifyWebhookRouter = Router();

interface ShopifyOrder {
  id?: number | string;
  name?: string;
  email?: string | null;
  currency?: string;
  total_price?: string | number;
  current_total_price?: string | number;
  created_at?: string;
  processed_at?: string;
  customer?: {
    id?: number | string;
    email?: string | null;
  } | null;
}

function orderTotal(order: ShopifyOrder): number {
  const raw = order.current_total_price ?? order.total_price ?? 0;
  return Math.max(0, Number(raw) || 0);
}

/** YYYY-MM-DD of order (UTC). Falls back to today if missing. */
function orderDateKey(order: ShopifyOrder): string {
  const raw = order.created_at || order.processed_at;
  if (!raw) return new Date().toISOString().slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function isOnOrAfterStartDate(order: ShopifyOrder): boolean {
  return orderDateKey(order) >= config.creditsStartDate;
}

shopifyWebhookRouter.post('/orders', async (req: Request, res: Response) => {
  try {
    const topic = req.get('X-Shopify-Topic') || '';
    const order = (req.body || {}) as ShopifyOrder;
    const orderId = String(order.id || '');

    if (!orderId) {
      res.status(400).json({ error: 'Missing order id' });
      return;
    }

    // Idempotency: Shopify may retry
    const existing = await query<{ shopify_order_id: string }>(
      `SELECT shopify_order_id FROM processed_orders WHERE shopify_order_id = $1`,
      [orderId]
    );
    if (existing.rows[0]) {
      res.status(200).json({ ok: true, duplicate: true, orderId });
      return;
    }

    const customerId = order.customer?.id != null ? String(order.customer.id) : '';
    const email = order.customer?.email || order.email || null;
    const total = orderTotal(order);
    const orderDay = orderDateKey(order);

    if (!isOnOrAfterStartDate(order)) {
      await query(
        `INSERT INTO processed_orders (shopify_order_id, shopify_customer_id, credits_added, note)
         VALUES ($1, $2, 0, $3)
         ON CONFLICT (shopify_order_id) DO NOTHING`,
        [
          orderId,
          customerId || null,
          `Skipped: order date ${orderDay} is before credits start ${config.creditsStartDate}`,
        ]
      );
      res.status(200).json({
        ok: true,
        skipped: true,
        reason: 'before_start_date',
        orderId,
        orderDate: orderDay,
        creditsStartDate: config.creditsStartDate,
      });
      return;
    }

    if (!customerId) {
      await query(
        `INSERT INTO processed_orders (shopify_order_id, shopify_customer_id, credits_added, note)
         VALUES ($1, NULL, 0, $2)
         ON CONFLICT (shopify_order_id) DO NOTHING`,
        [orderId, `Skipped: no customer on order (${topic || 'unknown topic'})`]
      );
      res.status(200).json({ ok: true, skipped: true, reason: 'no_customer', orderId });
      return;
    }

    const result = await applyOrderSpend(customerId, total, email);

    await query(
      `INSERT INTO processed_orders (shopify_order_id, shopify_customer_id, credits_added, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (shopify_order_id) DO NOTHING`,
      [
        orderId,
        customerId,
        result.creditsAdded,
        `Order ${order.name || orderId}; £${total.toFixed(2)} + remainder £${result.previousRemainder.toFixed(2)} = £${result.pooledSpend.toFixed(2)} → ${result.creditsAdded} credits, leftover £${result.newRemainder.toFixed(2)}; topic=${topic || 'n/a'}`,
      ]
    );

    res.status(200).json({
      ok: true,
      orderId,
      customerId,
      orderTotal: total,
      orderDate: orderDay,
      poundsPerCredit: config.creditsPoundsPerCredit,
      previousRemainder: result.previousRemainder,
      pooledSpend: result.pooledSpend,
      creditsAdded: result.creditsAdded,
      spendRemainder: result.newRemainder,
      creditsRemaining: result.customer.credits,
      totalSpend: result.customer.total_spend,
    });
  } catch (err) {
    console.error('Shopify order webhook error', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

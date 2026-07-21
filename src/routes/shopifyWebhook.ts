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

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      scope: 'shopify.orders.webhook',
      event,
      at: new Date().toISOString(),
      ...data,
    })
  );
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
  const topic = req.get('X-Shopify-Topic') || '';
  const shopDomain = req.get('X-Shopify-Shop-Domain') || '';
  const webhookId = req.get('X-Shopify-Webhook-Id') || '';

  try {
    const order = (req.body || {}) as ShopifyOrder;
    const orderId = String(order.id || '');
    const orderName = order.name || null;

    log('received', {
      topic,
      shopDomain,
      webhookId,
      orderId: orderId || null,
      orderName,
      hasBody: Boolean(req.body),
      bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 20) : [],
    });

    if (!orderId) {
      log('rejected', { reason: 'missing_order_id', topic, shopDomain });
      res.status(400).json({ error: 'Missing order id' });
      return;
    }

    // Idempotency: Shopify may retry
    const existing = await query<{ shopify_order_id: string }>(
      `SELECT shopify_order_id FROM processed_orders WHERE shopify_order_id = $1`,
      [orderId]
    );
    if (existing.rows[0]) {
      log('duplicate', { orderId, orderName, topic });
      res.status(200).json({ ok: true, duplicate: true, orderId });
      return;
    }

    const customerId = order.customer?.id != null ? String(order.customer.id) : '';
    const email = order.customer?.email || order.email || null;
    const total = orderTotal(order);
    const orderDay = orderDateKey(order);

    log('parsed', {
      orderId,
      orderName,
      topic,
      customerId: customerId || null,
      email,
      orderTotal: total,
      orderDate: orderDay,
      currency: order.currency || null,
      creditsStartDate: config.creditsStartDate,
      poundsPerCredit: config.creditsPoundsPerCredit,
    });

    if (!isOnOrAfterStartDate(order)) {
      log('skipped', {
        reason: 'before_start_date',
        orderId,
        orderName,
        orderDate: orderDay,
        creditsStartDate: config.creditsStartDate,
        customerId: customerId || null,
        orderTotal: total,
      });
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
      log('skipped', {
        reason: 'no_customer',
        orderId,
        orderName,
        topic,
        orderTotal: total,
      });
      await query(
        `INSERT INTO processed_orders (shopify_order_id, shopify_customer_id, credits_added, note)
         VALUES ($1, NULL, 0, $2)
         ON CONFLICT (shopify_order_id) DO NOTHING`,
        [orderId, `Skipped: no customer on order (${topic || 'unknown topic'})`]
      );
      res.status(200).json({ ok: true, skipped: true, reason: 'no_customer', orderId });
      return;
    }

    log('applying_spend', {
      orderId,
      orderName,
      customerId,
      email,
      orderTotal: total,
    });

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

    log('credited', {
      orderId,
      orderName,
      customerId,
      email,
      orderTotal: total,
      orderDate: orderDay,
      previousRemainder: result.previousRemainder,
      pooledSpend: result.pooledSpend,
      creditsAdded: result.creditsAdded,
      spendRemainder: result.newRemainder,
      creditsRemaining: result.customer.credits,
      totalSpend: result.customer.total_spend,
      topic,
    });

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
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log('error', { topic, shopDomain, webhookId, message, stack });
    console.error('Shopify order webhook error', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

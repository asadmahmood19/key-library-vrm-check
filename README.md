# VRM Check

UK vehicle registration lookup for Key Library, designed to embed in a Shopify page via iframe. Built with **Node.js + Express + TypeScript**, deployed on **Vercel**, using **Neon Postgres** and the [CheckCarDetails](https://api.checkcardetails.co.uk) vehiclespecs API.

## Features

- Minimal customer checker at `/` (credits, search, results, recent history)
- Password-protected admin dashboard at `/admin`
- 7-day VRM response cache (cached lookups do not burn credits)
- Credit-gated live API lookups
- Buy Credits button uses `BUY_CREDITS_URL` (placeholder until Shopify product flow)

## Setup

```bash
npm install
cp .env.example .env   # or use the provided .env
npm run migrate
npm run dev
```

Open:

- Checker: `http://localhost:3000/?customer_id=123&email=test@example.com`
- Admin: `http://localhost:3000/admin`

## Environment variables

| Variable | Purpose |
|---|---|
| `VEHICLE_API_KEY` | CheckCarDetails API key |
| `ADMIN_PASSWORD` | Admin dashboard password |
| `DATABASE_URL` | Neon Postgres connection string |
| `CACHE_DURATION_DAYS` | Cache TTL (default `7`) |
| `BUY_CREDITS_URL` | Buy Credits redirect (swap for Shopify product URL later) |
| `SESSION_SECRET` | Signed cookie session secret |
| `PORT` | Local port (default `3000`) |

## Shopify iframe embed

Add this to a Shopify page or theme section (customer must be logged in):

```liquid
{% if customer %}
  <iframe
    src="https://YOUR-VERCEL-URL/?customer_id={{ customer.id }}&email={{ customer.email | url_encode }}"
    width="100%"
    height="640"
    style="border:0;width:100%;"
    title="Vehicle registration checker"
  ></iframe>
{% else %}
  <p><a href="/account/login">Log in</a> to use the vehicle lookup.</p>
{% endif %}
```

No custom Shopify app or Admin API token is required for this version.

## Admin

1. Visit `/admin`
2. Enter `ADMIN_PASSWORD`
3. Assign credits to Shopify customer IDs
4. Review stats, lookup history, cache, and export CSV

## Deploy on Vercel

1. Push this repo to GitHub
2. Import the project in Vercel
3. Add the same environment variables in the Vercel project settings
4. Deploy
5. Update the Shopify iframe `src` to your Vercel URL

Schema migrations run automatically on first request (`ensureSchema`). You can also run `npm run migrate` locally against Neon.

## Credit rules

- **Cache hit** (VRM fetched within `CACHE_DURATION_DAYS`): return cached data, **no credit deducted**
- **Cache miss**: call CheckCarDetails, store cache, deduct **1 credit**, log lookup
- **Zero credits**: submit disabled; show Buy Credits → `BUY_CREDITS_URL`

## Shopify order webhook (auto-award credits)

**Webhook URL (use this in Shopify):**

```
https://key-library-vrm-check-theta.vercel.app/api/webhooks/shopify/orders
```

Recommended event: **Order payment** (`orders/paid`).

### Rule

**£10 of order subtotal = 1 lookup credit**, with **carry-over remainder** across orders.

Subtotal is used (after discounts), **excluding tax and delivery**.

Only orders on/after **`CREDITS_START_DATE`** (default `2026-07-22`) count.

Example:

| Day | Subtotal | Remainder before | Pooled | Credits added | Remainder after |
|-----|----------|------------------|--------|---------------|-----------------|
| 1 | £9 | £0 | £9 | 0 | £9 |
| 2 | £11 | £9 | £20 | 2 | £0 |

### Setup

1. Shopify Admin → **Settings → Notifications → Webhooks**
2. Create webhook:
   - Event: **Order payment**
   - Format: **JSON**
   - URL: the webhook URL above
3. Optional env vars:
   - `CREDITS_POUNDS_PER_CREDIT` (default `10`)
   - `CREDITS_START_DATE` (default `2026-07-22`)

The endpoint finds the customer, adds the order **subtotal** to their spend remainder, awards whole credits, keeps leftover spend, and ignores duplicate order deliveries.


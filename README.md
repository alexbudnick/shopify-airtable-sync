# Shopify → Airtable Sync (current Shopify UI / Dev Dashboard token flow)

This version is updated for the current Shopify UI where Dev Dashboard apps use:
- Client ID
- Client Secret
- client credentials grant for short-lived Admin API tokens

Prefilled for:
- Store domain: aflashfloodofgear.myshopify.com

## What it does

- receives Shopify `products/update` webhooks
- updates Airtable listing status from Shopify
- syncs Shopify price into Airtable
- stores Shopify Product ID and Shopify Variant ID in Airtable
- receives Shopify `orders/create` webhooks
- marks Airtable items as sold
- sets `Qty On Hand = 0` on sale
- keeps the item's location intact by default

## Replace these values in `.env.example`

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `AIRTABLE_PAT`
- `AIRTABLE_BASE_ID`

## Local setup

```bash
npm install
cp .env.example .env
npm run sync-once
```

Start with:
```env
DRY_RUN=true
```

## Railway setup

1. Create a Railway project.
2. Upload this folder or connect a repo.
3. Add all variables from `.env.example`.
4. Deploy.
5. Keep `DRY_RUN=true` for first tests.

## Shopify webhooks

Create these webhooks for your store:
- `products/update` → `https://YOUR-RAILWAY-URL/webhooks/shopify/products-update`
- `orders/create` → `https://YOUR-RAILWAY-URL/webhooks/shopify/orders-create`

Use JSON format.

## Suggested rollout

1. Deploy to Railway
2. Run `npm run sync-once`
3. Add Shopify webhooks
4. Test one product update
5. Test one order
6. Switch `DRY_RUN=false`

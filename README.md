# Shopify → Airtable Sync with exact quantity and inventory webhook

## Guarded two-way Price and Cost

Run `npm run sync-price-cost` on a separate Railway cron (for example every 15 minutes).
Create three fields in Airtable Inventory first: currency `Shopify Price Last Synced`, currency
`Shopify Cost Last Synced`, and single-line text `Price Cost Sync Review`.
The app needs Shopify `write_products` and `write_inventory` in addition to its read scopes.
This command touches only Price, Cost, and those three tracking fields; it never adjusts Qty.

Every run compares both systems to each field's last synced value. A change on only one
side propagates. Two different changes, a blank attempting to erase a value, duplicate
Shopify SKUs, or an initial mismatch need review. The first run deliberately flags
preexisting nonblank mismatches rather than silently picking a winner. If one side is
blank and the other populated, it fills the blank side. Set `DRY_RUN=true` for the
first run and review the summary and logged proposed writes before enabling writes.
The normal product webhook and `sync-once` do not write Price; run this command regularly.

This version adds exact Shopify quantity sync and also listens for inventory adjustments.

## New behavior
- `products/update` fetches exact `inventoryQuantity`
- `inventory_levels/update` webhook updates Airtable `Qty On Hand` when quantity is adjusted in Shopify
- `orders/create` still sets `Qty On Hand = 0` when sold

## Shopify scopes
Make sure your Shopify app includes:
- read_products
- read_orders
- read_inventory

## Shopify webhooks to configure
- products/update -> /webhooks/shopify/products-update
- orders/create -> /webhooks/shopify/orders-create
- inventory_levels/update -> /webhooks/shopify/inventory-levels-update

## Install
Replace the files in your GitHub repo with these files, let Railway redeploy, then add the new inventory webhook in Shopify.

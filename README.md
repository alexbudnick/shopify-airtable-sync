# Shopify → Airtable Sync with exact quantity and inventory webhook

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

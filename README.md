# Shopify → Airtable Sync with Qty

Upgrade version that also syncs Shopify inventory quantity into Airtable.

## Added behavior
- product updates now fetch Shopify inventory quantity
- Airtable `Qty On Hand` updates from Shopify
- order creates still set `Qty On Hand = 0`

## Shopify scope required
Add this scope in Shopify if missing:
- `read_inventory`

## How to install
Replace the files in your GitHub repo with these files, let Railway redeploy, then test:
- product price change
- inventory quantity change

## Expected Airtable fields
SKU
Status
Location
Qty On Hand
Price
Shopify Product ID
Shopify Variant ID
Shopify Status
Listed
Channel
Last Sync Source
Last Sync At
Sold Channel
Sold Date

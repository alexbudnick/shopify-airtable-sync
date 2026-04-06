import { CFG, logger, shopifyGraphQL, findAirtableRecordBySku, createAirtableRecord, updateAirtableRecord, nowIso } from "./lib.js";

async function main() {
  const query = `
    query Products($cursor: String) {
      products(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  sku
                  price
                }
              }
            }
          }
        }
      }
    }
  `;
  let cursor = null;
  let total = 0;

  while (true) {
    const data = await shopifyGraphQL(query, { cursor });
    const products = data.products.edges.map(e => e.node);

    for (const p of products) {
      const variant = p.variants.edges?.[0]?.node;
      const sku = variant?.sku;
      if (!sku) continue;
      const record = await findAirtableRecordBySku(sku);
      const status = String(p.status || "").toUpperCase();
      const fields = {
        [CFG.airtable.shopifyProductIdField]: String(p.id),
        [CFG.airtable.shopifyVariantIdField]: String(variant.id),
        [CFG.airtable.shopifyStatusField]: status,
        [CFG.airtable.listedField]: status === "ACTIVE",
        [CFG.airtable.channelField]: CFG.values.channelMain,
        [CFG.airtable.priceField]: Number(variant.price),
        [CFG.airtable.lastSyncSourceField]: "Shopify",
        [CFG.airtable.lastSyncAtField]: nowIso(),
      };
      if (status === "ACTIVE") fields[CFG.airtable.statusField] = CFG.values.listedMain;

      if (record) await updateAirtableRecord(record.id, fields);
      else await createAirtableRecord({
        [CFG.airtable.skuField]: sku,
        [CFG.airtable.qtyField]: 1,
        ...fields,
      });
      total += 1;
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  console.log(JSON.stringify({ ok: true, productsProcessed: total }, null, 2));
}

main().catch(err => {
  logger("error", "sync-once failed", err.message);
  process.exit(1);
});

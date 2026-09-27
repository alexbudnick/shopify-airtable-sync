import { CFG, airtableRequest, shopifyGraphQL, updateAirtableRecord, logger } from "./lib.js";
import { decideMoneySync, money } from "./price_cost_decision.js";

const query = `query PriceCostProducts($cursor: String) {
  products(first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id variants(first: 20) { pageInfo { hasNextPage } nodes {
      id sku price inventoryItem { id unitCost { amount } }
    } } }
  }
}`;

async function airtableRecords() {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    params.set("filterByFormula", `LEN({${CFG.airtable.shopifyVariantIdField}})>0`);
    for (const field of [CFG.airtable.skuField, CFG.airtable.shopifyVariantIdField,
      CFG.airtable.priceField, CFG.airtable.costField, CFG.airtable.lastPriceField,
      CFG.airtable.lastCostField, CFG.airtable.priceCostReviewField]) params.append("fields[]", field);
    if (offset) params.set("offset", offset);
    const page = await airtableRequest(`?${params}`);
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

async function shopifyVariants() {
  const variants = [];
  let cursor = null;
  do {
    const data = await shopifyGraphQL(query, { cursor });
    if (!data?.products) throw new Error("Shopify product query returned no products connection");
    for (const product of data.products.nodes) {
      if (product.variants.pageInfo.hasNextPage) {
        logger("warn", "Product has more than 20 variants; skipping price/cost sync", { productId: product.id });
        continue;
      }
      for (const variant of product.variants.nodes) variants.push({ ...variant, productId: product.id });
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
  return variants;
}

function canonicalId(value) { return String(value || "").split("/").at(-1); }

async function updateShopifyPrice(variant, amount) {
  const data = await shopifyGraphQL(`mutation Price($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
  }`, { productId: variant.productId, variants: [{ id: variant.id, price: amount }] });
  const errors = data?.productVariantsBulkUpdate?.userErrors;
  if (!errors || errors.length) throw new Error(`Shopify price update failed: ${JSON.stringify(errors)}`);
}

async function updateShopifyCost(variant, amount) {
  const data = await shopifyGraphQL(`mutation Cost($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) { userErrors { field message } }
  }`, { id: variant.inventoryItem.id, input: { cost: amount } });
  const errors = data?.inventoryItemUpdate?.userErrors;
  if (!errors || errors.length) throw new Error(`Shopify cost update failed: ${JSON.stringify(errors)}`);
}

async function main() {
  const records = await airtableRecords();
  const variants = await shopifyVariants();
  const byId = new Map(variants.map(v => [canonicalId(v.id), v]));
  const bySku = new Map();
  for (const v of variants) if (v.sku) bySku.set(v.sku, [...(bySku.get(v.sku) || []), v]);
  const airtableIdCounts = new Map();
  for (const record of records) {
    const id = canonicalId(record.fields[CFG.airtable.shopifyVariantIdField]);
    airtableIdCounts.set(id, (airtableIdCounts.get(id) || 0) + 1);
  }
  const counts = { examined: 0, updated: 0, review: 0, unchanged: 0 };
  const preview = [];
  const decisions = { price: { baseline: 0, toShopify: 0, toAirtable: 0, review: 0 }, cost: { baseline: 0, toShopify: 0, toAirtable: 0, review: 0 } };
  const proposedFields = { price: 0, cost: 0, lastPrice: 0, lastCost: 0, review: 0 };
  for (const record of records) {
    const f = record.fields;
    const id = canonicalId(f[CFG.airtable.shopifyVariantIdField]);
    if (!id) continue; // Never create or match an unlisted item by SKU alone.
    const variant = byId.get(id);
    if (!variant || airtableIdCounts.get(id) !== 1 ||
        f[CFG.airtable.skuField] !== variant.sku || bySku.get(variant.sku)?.length !== 1) continue;
    counts.examined++;
    const fields = {};
    const problems = [];
    for (const entry of [
      { label: "Price", field: CFG.airtable.priceField, mirror: CFG.airtable.lastPriceField, shopify: variant.price, push: updateShopifyPrice },
      { label: "Cost", field: CFG.airtable.costField, mirror: CFG.airtable.lastCostField, shopify: variant.inventoryItem?.unitCost?.amount, push: updateShopifyCost }
    ]) {
      try {
        const decision = decideMoneySync(f[entry.field], entry.shopify, f[entry.mirror]);
        decisions[entry.label.toLowerCase()][decision.action]++;
        if (decision.action === "review") {
          problems.push(`${entry.label}: ${decision.reason}`);
          if (CFG.dryRun) logger("info", "Price/cost needs review", { sku: variant.sku, field: entry.label, airtable: f[entry.field] ?? null, shopify: entry.shopify ?? null, lastSynced: f[entry.mirror] ?? null, reason: decision.reason });
          continue;
        }
        if (decision.action === "baseline") {
          if (decision.value !== null && money(f[entry.mirror]) !== decision.value) fields[entry.mirror] = Number(decision.value);
        } else if (decision.action === "toShopify") {
          if (CFG.dryRun) {
            if (preview.length < 20) preview.push({ sku: variant.sku, target: "Shopify", field: entry.label, value: decision.value });
          } else await entry.push(variant, decision.value);
          if (!CFG.dryRun) fields[entry.mirror] = Number(decision.value);
        } else {
          fields[entry.field] = Number(decision.value);
          fields[entry.mirror] = Number(decision.value);
        }
      } catch (error) {
        decisions[entry.label.toLowerCase()].review++;
        problems.push(`${entry.label}: ${error.message}`);
        if (CFG.dryRun) logger("info", "Price/cost needs review", { sku: variant.sku, field: entry.label, airtable: f[entry.field] ?? null, shopify: entry.shopify ?? null, lastSynced: f[entry.mirror] ?? null, reason: error.message });
      }
    }
    const review = problems.join("; ");
    if (review !== String(f[CFG.airtable.priceCostReviewField] || "")) fields[CFG.airtable.priceCostReviewField] = review || null;
    if (Object.keys(fields).length) {
      for (const [label, field] of Object.entries({ price: CFG.airtable.priceField, cost: CFG.airtable.costField, lastPrice: CFG.airtable.lastPriceField, lastCost: CFG.airtable.lastCostField, review: CFG.airtable.priceCostReviewField })) if (Object.hasOwn(fields, field)) proposedFields[label]++;
      if (CFG.dryRun) {
        if (preview.length < 20) preview.push({ sku: variant.sku, target: "Airtable", fields });
      } else await updateAirtableRecord(record.id, fields);
      counts.updated++;
    }
    else counts.unchanged++;
    if (problems.length) counts.review++;
  }
  console.log(JSON.stringify({ ok: true, dryRun: CFG.dryRun, updatedMeaning: CFG.dryRun ? "proposed" : "written", ...counts, decisions, proposedFields, preview }));
}

main().catch(error => { logger("error", "price/cost sync failed", error.message); process.exit(1); });

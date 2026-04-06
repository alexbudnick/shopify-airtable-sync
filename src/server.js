import express from "express";
import {
  CFG, logger, verifyShopifyWebhook, findAirtableRecordBySku, findAirtableRecordByProductId,
  updateAirtableRecord, createAirtableRecord, extractFirstVariant, normalizeShopifyStatus, nowIso
} from "./lib.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);

async function upsertListingByProduct(productPayload) {
  const productId = String(productPayload.id);
  const variant = extractFirstVariant(productPayload);
  const sku = variant?.sku || null;
  if (!sku) {
    logger("warn", "Shopify product update missing SKU; skipping", { productId });
    return;
  }

  const record = await findAirtableRecordBySku(sku) || await findAirtableRecordByProductId(productId);
  const status = normalizeShopifyStatus(productPayload.status);
  const price = variant?.price != null ? Number(variant.price) : null;
  const variantId = variant?.admin_graphql_api_id || variant?.id || null;

  const fields = {
    [CFG.airtable.shopifyProductIdField]: productId,
    [CFG.airtable.shopifyVariantIdField]: variantId ? String(variantId) : undefined,
    [CFG.airtable.shopifyStatusField]: status,
    [CFG.airtable.listedField]: status === "ACTIVE",
    [CFG.airtable.channelField]: CFG.values.channelMain,
    [CFG.airtable.lastSyncSourceField]: "Shopify",
    [CFG.airtable.lastSyncAtField]: nowIso(),
  };
  if (price != null) fields[CFG.airtable.priceField] = price;
  if (status === "ACTIVE") fields[CFG.airtable.statusField] = CFG.values.listedMain;
  Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k]);

  if (record) {
    await updateAirtableRecord(record.id, fields);
    logger("info", "Updated Airtable from Shopify product", { sku, productId, status, price });
  } else {
    await createAirtableRecord({
      [CFG.airtable.skuField]: sku,
      [CFG.airtable.qtyField]: 1,
      ...fields,
    });
    logger("info", "Created Airtable record from Shopify product", { sku, productId, status, price });
  }
}

async function markSoldByLineItems(orderPayload) {
  const lineItems = Array.isArray(orderPayload.line_items) ? orderPayload.line_items : [];
  for (const item of lineItems) {
    const sku = item?.sku;
    if (!sku) {
      logger("warn", "Order line missing SKU; skipping", { orderId: orderPayload.id });
      continue;
    }
    const record = await findAirtableRecordBySku(sku);
    if (!record) {
      logger("warn", "No Airtable record found for sold SKU", { sku, orderId: orderPayload.id });
      continue;
    }
    const fields = {
      [CFG.airtable.statusField]: CFG.values.sold,
      [CFG.airtable.qtyField]: 0,
      [CFG.airtable.soldChannelField]: CFG.values.soldChannelShopify,
      [CFG.airtable.soldDateField]: nowIso(),
      [CFG.airtable.listedField]: false,
      [CFG.airtable.lastSyncSourceField]: "Shopify",
      [CFG.airtable.lastSyncAtField]: nowIso(),
    };
    if (CFG.values.clearLocationOnSale) fields[CFG.airtable.locationField] = null;
    await updateAirtableRecord(record.id, fields);
    logger("info", "Marked Airtable item sold from Shopify order", { sku, orderId: orderPayload.id });
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "shopify-airtable-sync-current-ui", dryRun: CFG.dryRun, store: CFG.shopify.storeDomain });
});

app.post("/webhooks/shopify/products-update", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const hmac = req.get("X-Shopify-Hmac-Sha256");
    const rawBody = req.body.toString("utf8");
    if (!verifyShopifyWebhook(rawBody, hmac)) return res.status(401).send("Invalid HMAC");
    await upsertListingByProduct(JSON.parse(rawBody));
    return res.status(200).send("ok");
  } catch (err) {
    logger("error", "products-update webhook failed", err.message);
    return res.status(500).send("error");
  }
});

app.post("/webhooks/shopify/orders-create", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const hmac = req.get("X-Shopify-Hmac-Sha256");
    const rawBody = req.body.toString("utf8");
    if (!verifyShopifyWebhook(rawBody, hmac)) return res.status(401).send("Invalid HMAC");
    await markSoldByLineItems(JSON.parse(rawBody));
    return res.status(200).send("ok");
  } catch (err) {
    logger("error", "orders-create webhook failed", err.message);
    return res.status(500).send("error");
  }
});

app.listen(PORT, () => logger("info", `Listening on port ${PORT}`));

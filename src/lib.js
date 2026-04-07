import crypto from "crypto";
import dotenv from "dotenv";
import { log, safeUpper } from "./common.js";

dotenv.config();

export const CFG = {
  logLevel: process.env.LOG_LEVEL || "info",
  dryRun: String(process.env.DRY_RUN || "false").toLowerCase() === "true",
  shopify: {
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN || "",
    clientId: process.env.SHOPIFY_CLIENT_ID || "",
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET || "",
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET || "",
    apiVersion: process.env.SHOPIFY_API_VERSION || "2025-07",
  },
  airtable: {
    pat: process.env.AIRTABLE_PAT || "",
    baseId: process.env.AIRTABLE_BASE_ID || "",
    tableName: process.env.AIRTABLE_TABLE_NAME || "Inventory",
    skuField: process.env.AIRTABLE_SKU_FIELD || "SKU",
    statusField: process.env.AIRTABLE_STATUS_FIELD || "Status",
    locationField: process.env.AIRTABLE_LOCATION_FIELD || "Location",
    qtyField: process.env.AIRTABLE_QTY_FIELD || "Qty On Hand",
    soldChannelField: process.env.AIRTABLE_SOLD_CHANNEL_FIELD || "Sold Channel",
    soldDateField: process.env.AIRTABLE_SOLD_DATE_FIELD || "Sold Date",
    shopifyProductIdField: process.env.AIRTABLE_SHOPIFY_PRODUCT_ID_FIELD || "Shopify Product ID",
    shopifyVariantIdField: process.env.AIRTABLE_SHOPIFY_VARIANT_ID_FIELD || "Shopify Variant ID",
    shopifyStatusField: process.env.AIRTABLE_SHOPIFY_STATUS_FIELD || "Shopify Status",
    listedField: process.env.AIRTABLE_LISTED_FIELD || "Listed",
    channelField: process.env.AIRTABLE_CHANNEL_FIELD || "Channel",
    priceField: process.env.AIRTABLE_PRICE_FIELD || "Price",
    costField: process.env.AIRTABLE_COST_FIELD || "Cost",
    lastSyncSourceField: process.env.AIRTABLE_LAST_SYNC_SOURCE_FIELD || "Last Sync Source",
    lastSyncAtField: process.env.AIRTABLE_LAST_SYNC_AT_FIELD || "Last Sync At",
  },
  values: {
    listedMain: process.env.STATUS_LISTED_MAIN || "LISTED - MAIN",
    sold: process.env.STATUS_SOLD || "SOLD",
    channelMain: process.env.CHANNEL_MAIN || "MAIN",
    soldChannelShopify: process.env.SOLD_CHANNEL_SHOPIFY || "SHOPIFY",
    clearLocationOnSale: String(process.env.CLEAR_LOCATION_ON_SALE || "false").toLowerCase() === "true",
  }
};

export function logger(level, msg, meta) {
  return log(level, CFG.logLevel, msg, meta);
}

export function verifyShopifyWebhook(rawBody, hmacHeader) {
  const digest = crypto.createHmac("sha256", CFG.shopify.webhookSecret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getShopifyAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt - now > 60000) return cachedToken;

  const res = await fetch(`https://${CFG.shopify.storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CFG.shopify.clientId,
      client_secret: CFG.shopify.clientSecret,
      grant_type: "client_credentials"
    })
  });

  if (!res.ok) throw new Error(`Shopify token request failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiresAt = now + ((json.expires_in || 86400) * 1000);
  return cachedToken;
}

export async function airtableRequest(path = "", options = {}) {
  const url = `https://api.airtable.com/v0/${CFG.airtable.baseId}/${encodeURIComponent(CFG.airtable.tableName)}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${CFG.airtable.pat}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Airtable request failed ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function findAirtableRecordBySku(sku) {
  const formula = `{${CFG.airtable.skuField}}="${String(sku).replace(/"/g, '\\"')}"`;
  const payload = await airtableRequest(`?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`);
  return payload.records?.[0] || null;
}

export async function findAirtableRecordByProductId(productId) {
  const formula = `{${CFG.airtable.shopifyProductIdField}}="${String(productId).replace(/"/g, '\\"')}"`;
  const payload = await airtableRequest(`?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`);
  return payload.records?.[0] || null;
}

export async function updateAirtableRecord(recordId, fields) {
  if (CFG.dryRun) {
    logger("info", "DRY_RUN enabled; would update Airtable record", { recordId, fields });
    return { dryRun: true };
  }
  return airtableRequest("", { method: "PATCH", body: JSON.stringify({ records: [{ id: recordId, fields }] }) });
}

export async function createAirtableRecord(fields) {
  if (CFG.dryRun) {
    logger("info", "DRY_RUN enabled; would create Airtable record", fields);
    return { dryRun: true };
  }
  return airtableRequest("", { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
}

export async function shopifyGraphQL(query, variables = {}) {
  const token = await getShopifyAccessToken();
  const res = await fetch(`https://${CFG.shopify.storeDomain}/admin/api/${CFG.shopify.apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`Shopify GraphQL failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

export async function getVariantInventoryData(productIdGid, skuHint = null) {
  const query = `
    query ProductInventory($id: ID!) {
      product(id: $id) {
        variants(first: 50) {
          edges {
            node {
              id
              sku
              price
              inventoryQuantity
              inventoryItem { tracked }
            }
          }
        }
      }
    }
  `;
  const data = await shopifyGraphQL(query, { id: productIdGid });
  const variants = data?.product?.variants?.edges?.map(e => e.node) || [];
  let variant = null;
  if (skuHint) variant = variants.find(v => String(v.sku || "") === String(skuHint));
  if (!variant) variant = variants[0] || null;
  if (!variant) return null;
  return {
    variantId: variant.id,
    sku: variant.sku || skuHint,
    price: variant.price != null ? Number(variant.price) : null,
    inventoryQuantity: Number(variant.inventoryQuantity ?? 0),
    tracked: Boolean(variant.inventoryItem?.tracked)
  };
}

export function extractFirstVariant(productPayload) {
  if (Array.isArray(productPayload.variants) && productPayload.variants.length > 0) return productPayload.variants[0];
  return null;
}

export function nowIso() { return new Date().toISOString(); }
export function normalizeShopifyStatus(status) { return safeUpper(status); }

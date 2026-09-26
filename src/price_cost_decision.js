export function money(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || Math.round(amount * 100) !== amount * 100) {
    throw new Error(`Invalid money value: ${value}`);
  }
  return amount.toFixed(2);
}

export function decideMoneySync(airtable, shopify, lastSynced) {
  const a = money(airtable), s = money(shopify), last = money(lastSynced);
  if (last === null) {
    if (a === s) return { action: "baseline", value: a };
    if (a !== null && s === null) return { action: "toShopify", value: a };
    if (a === null && s !== null) return { action: "toAirtable", value: s };
    return { action: "review", reason: "Different values before first sync" };
  }
  if (a === s) return { action: "baseline", value: a };
  const airtableChanged = a !== last, shopifyChanged = s !== last;
  if (airtableChanged && shopifyChanged) return { action: "review", reason: "Both sides changed" };
  if (airtableChanged && a !== null) return { action: "toShopify", value: a };
  if (shopifyChanged && s !== null) return { action: "toAirtable", value: s };
  return { action: "review", reason: "Blank value would erase a populated value" };
}

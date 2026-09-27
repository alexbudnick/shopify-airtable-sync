import test from "node:test";
import assert from "node:assert/strict";
import { decideMoneySync } from "../src/price_cost_decision.js";

test("initial disagreement requires review, while agreement establishes a baseline", () => {
  assert.equal(decideMoneySync(100, 110, null).action, "review");
  assert.deepEqual(decideMoneySync(100, 100, null), { action: "baseline", value: "100.00" });
  assert.deepEqual(decideMoneySync(100, null, null), { action: "toShopify", value: "100.00" });
  assert.deepEqual(decideMoneySync(null, 100, null), { action: "toAirtable", value: "100.00" });
});

test("one-sided changes propagate and concurrent changes are held", () => {
  assert.deepEqual(decideMoneySync(120, 100, 100), { action: "toShopify", value: "120.00" });
  assert.deepEqual(decideMoneySync(100, 120, 100), { action: "toAirtable", value: "120.00" });
  assert.equal(decideMoneySync(120, 110, 100).action, "review");
  assert.deepEqual(decideMoneySync(120, 120, 100), { action: "baseline", value: "120.00" });
});

test("blank and invalid costs cannot silently erase stock accounting", () => {
  assert.equal(decideMoneySync(null, 50, 50).action, "review");
  assert.equal(decideMoneySync(50, null, 50).action, "review");
  assert.deepEqual(decideMoneySync(0, 10, 10), { action: "toShopify", value: "0.00" });
  assert.throws(() => decideMoneySync(-1, 10, 10));
});

test("ordinary cent amounts survive floating point representation", () => {
  assert.deepEqual(decideMoneySync(273.78, 273.78, null), { action: "baseline", value: "273.78" });
  assert.deepEqual(decideMoneySync(1214.1, 1214.1, null), { action: "baseline", value: "1214.10" });
  assert.throws(() => decideMoneySync(1.001, 1, null));
});

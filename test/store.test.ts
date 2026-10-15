import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ShopError, ShopStore } from "../lib/store";

function fixture(t: { after: (callback: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "firedrill-shop-"));
  const store = new ShopStore(join(dir, "shop.db"));
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}

function rejects(code: string) {
  return (error: unknown) => error instanceof ShopError && error.code === code;
}

test("unavailable product suggests a current in-stock substitute", (t) => {
  const store = fixture(t);
  const linen = store.product("towel-01")!;
  assert.equal(linen.stock, 0);
  assert.deepEqual(store.alternatives(linen.id).map((item) => item.id), ["towel-02"]);
  assert.throws(() => store.add(linen.id, 1, linen.revision), rejects("out_of_stock"));
  assert.equal(store.state().cart.length, 0);
});

test("cart rejects budget overshoot and keeps previous lines", (t) => {
  const store = fixture(t);
  store.add("lamp-01", 1, 1);
  store.add("lamp-02", 1, 1);
  assert.equal(store.state().total_cents, 14200);
  assert.throws(() => store.add("mug-01", 1, 1), rejects("over_budget"));
  assert.equal(store.state().total_cents, 14200);
  assert.equal(store.state().remaining_cents, 800);
});

test("revision and stock are rechecked before checkout", (t) => {
  const store = fixture(t);
  store.add("lamp-01", 2, 1);
  store.setStockForScenario("lamp-01", 1);
  assert.throws(() => store.add("lamp-01", 1, 1), rejects("stale_product"));
  assert.throws(() => store.checkout(), rejects("out_of_stock"));
  assert.equal(store.state().cart[0].quantity, 2);
  store.setStockForScenario("lamp-01", 2);
  const order = store.checkout();
  assert.equal(order.total_cents, 13600);
  assert.equal(order.lines[0].quantity, 2);
  assert.equal(store.product("lamp-01")!.stock, 0);
  assert.equal(store.state().cart.length, 0);
  assert.throws(() => store.checkout(), rejects("empty_cart"));
});

test("cart state persists across store instances and removal is explicit", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "firedrill-shop-persist-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "shop.db");
  const first = new ShopStore(path);
  first.add("bottle-01", 2, 1);
  first.close();
  const second = new ShopStore(path);
  t.after(() => second.close());
  assert.equal(second.state().cart[0].quantity, 2);
  assert.equal(second.remove("bottle-01").total_cents, 0);
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { checkoutHandler } from "../lib/checkout-api";
import { ShopError, ShopStore } from "../lib/store";

function fixture(t: { after: (callback: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "firedrill-shop-checkout-"));
  const path = join(dir, "shop.db");
  const store = new ShopStore(path);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, path, store };
}
const intent = (store: ShopStore) => ({
  request_id: randomUUID(),
  expected_cart_token: store.state().checkout_token,
});
const rejects = (code: string) => (error: unknown) =>
  error instanceof ShopError && error.code === code;

test("price changes within the budget still require review of the current cart", (t) => {
  const { store, path } = fixture(t);
  store.add("mug-01", 1, 1);
  const reviewed = intent(store);
  const other = new DatabaseSync(path);
  other
    .prepare(
      "UPDATE products SET price_cents=2900,revision=revision+1 WHERE id=?",
    )
    .run("mug-01");
  other.close();
  assert.throws(() => store.checkout(reviewed), rejects("stale_cart"));
  assert.equal(store.orders().length, 0);
  assert.equal(store.state().cart[0].quantity, 1);
  assert.equal(store.checkout(intent(store)).total_cents, 2900);
});

test("exact checkout recovery returns its immutable order and preserves a newer cart", (t) => {
  const { store } = fixture(t);
  store.add("mug-01", 1, 1);
  const reviewed = intent(store);
  const first = store.checkout(reviewed);
  assert.equal(first.replayed, false);
  store.add("bottle-01", 1, 1);
  const newer = store.state();
  const replay = store.checkout(reviewed);
  assert.equal(replay.replayed, true);
  assert.equal(replay.order_id, first.order_id);
  assert.deepEqual(replay.lines, JSON.parse(JSON.stringify(first.lines)));
  assert.deepEqual(store.state(), newer);
  assert.equal(store.orders().length, 1);
  assert.throws(
    () =>
      store.checkout({
        ...reviewed,
        expected_cart_token: newer.checkout_token,
      }),
    rejects("request_reused"),
  );
  assert.deepEqual(store.state(), newer);
});

test("cart add/remove history invalidates an old token even when its visible lines match", (t) => {
  const { store } = fixture(t);
  store.add("mug-01", 1, 1);
  const reviewed = intent(store);
  store.add("bottle-01", 1, 1);
  store.remove("bottle-01");
  assert.throws(() => store.checkout(reviewed), rejects("stale_cart"));
  assert.equal(store.orders().length, 0);
});

test("independent private shop instances cannot accept each other's reviewed cart", (t) => {
  const first = fixture(t);
  const second = fixture(t);
  first.store.add("mug-01", 1, 1);
  second.store.add("mug-01", 1, 1);
  assert.notEqual(first.store.state().state_id, second.store.state().state_id);
  assert.throws(
    () => second.store.checkout(intent(first.store)),
    rejects("stale_cart"),
  );
  assert.equal(second.store.orders().length, 0);
});

test("two connections recover one checkout request without a second stock decrement", (t) => {
  const { store, path } = fixture(t);
  store.add("mug-01", 1, 1);
  const reviewed = intent(store);
  const other = new ShopStore(path);
  t.after(() => other.close());
  const first = store.checkout(reviewed);
  const replay = other.checkout(reviewed);
  assert.equal(first.order_id, replay.order_id);
  assert.equal(replay.replayed, true);
  assert.equal(store.product("mug-01")!.stock, 3);
  assert.equal(store.orders().length, 1);
});

test("precommit cancellation rolls back stock, cart revision and order together", (t) => {
  const { store } = fixture(t);
  store.add("mug-01", 1, 1);
  const reviewed = intent(store);
  const before = store.state();
  let checks = 0;
  assert.throws(
    () =>
      store.checkout(reviewed, () => {
        if (++checks === 2)
          throw new ShopError("cancelled", "Synthetic precommit cancellation");
      }),
    rejects("cancelled"),
  );
  assert.deepEqual(store.state(), before);
  assert.equal(store.orders().length, 0);
});

test("strict checkout HTTP rejects extra/missing intent before opening the store", async () => {
  let opened = 0;
  const post = checkoutHandler(() => {
    opened++;
    throw new Error("should not open");
  });
  for (const body of [
    {},
    { request_id: "r", expected_cart_token: "0".repeat(64), unreviewed: true },
  ]) {
    const response = await post(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );
    assert.equal(response.status, 400);
  }
  assert.equal(opened, 0);
});

test("lost HTTP acknowledgement after commit recovers the existing order exactly", async (t) => {
  const { store } = fixture(t);
  store.add("mug-01", 1, 1);
  const reviewed = intent(store);
  const original = store.checkout.bind(store);
  store.checkout = (value, guard) => {
    original(value, guard);
    throw new Error("Synthetic acknowledgement lost after commit");
  };
  const post = checkoutHandler(() => store);
  const request = () =>
    new Request("http://localhost/api/checkout", {
      method: "POST",
      body: JSON.stringify(reviewed),
      headers: { "content-type": "application/json" },
    });
  assert.equal((await post(request())).status, 500);
  assert.equal(store.orders().length, 1);
  store.checkout = original;
  store.add("bottle-01", 1, 1);
  const replay = await post(request());
  const result = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(result.replayed, true);
  assert.equal(result.lines[0].product_id, "mug-01");
  assert.equal(result.state.cart[0].product_id, "bottle-01");
  assert.equal(store.orders().length, 1);
});

test("new shop DB and WAL files inherit private modes", (t) => {
  const { path, store } = fixture(t);
  store.add("mug-01", 1, 1);
  for (const suffix of ["", "-wal", "-shm"])
    assert.equal(statSync(path + suffix).mode & 0o777, 0o600);
});

test("populated legacy orders and cart survive migration without invented request bindings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "firedrill-shop-legacy-"));
  const path = join(root, "shop.db");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,price_cents INTEGER NOT NULL,stock INTEGER NOT NULL,revision INTEGER NOT NULL);
    CREATE TABLE carts(id TEXT PRIMARY KEY,budget_cents INTEGER NOT NULL);
    CREATE TABLE cart_lines(cart_id TEXT NOT NULL REFERENCES carts(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity>0),PRIMARY KEY(cart_id,product_id));
    CREATE TABLE orders(id INTEGER PRIMARY KEY AUTOINCREMENT,cart_id TEXT NOT NULL,lines_json TEXT NOT NULL,total_cents INTEGER NOT NULL,created_at TEXT NOT NULL);
    INSERT INTO products VALUES('mug-01','Stoneware mug','Tabletop','Matte clay, 350 ml',2800,4,7);
    INSERT INTO carts VALUES('demo',15000);
    INSERT INTO cart_lines VALUES('demo','mug-01',1);
  `);
  const historical =
    '[{"product_id":"mug-01","name":"Stoneware mug","quantity":1,"price_cents":2800,"stock":5,"revision":6}]';
  legacy
    .prepare(
      "INSERT INTO orders VALUES(7,'demo',?,2800,'2026-10-14T09:00:00Z')",
    )
    .run(historical);
  legacy.close();
  const store = new ShopStore(path);
  t.after(() => store.close());
  const migrated = store.orders()[0];
  assert.equal(migrated.id, 7);
  assert.equal(migrated.lines_json, historical);
  assert.equal(migrated.created_at, "2026-10-14T09:00:00Z");
  assert.equal(migrated.request_id, null);
  assert.equal(migrated.expected_cart_token, null);
  assert.equal(store.state().cart[0].quantity, 1);
  assert.equal(store.product("mug-01")!.revision, 7);
  const placed = store.checkout(intent(store));
  assert.equal(placed.order_id, 8);
  assert.equal(store.orders().length, 2);
  assert.equal(store.orders()[0].lines_json, historical);
});

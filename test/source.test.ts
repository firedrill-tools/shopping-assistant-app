import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ShopError, ShopStore } from "../lib/store";

function fixture(t: { after: (work: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "firedrill-shop-source-")),
    path = join(root, "shop.db"),
    store = new ShopStore(path);
  store.add("mug-01", 1, 1);
  store.checkout({
    request_id: randomUUID(),
    expected_cart_token: store.state().checkout_token,
  });
  store.close();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return path;
}
const invalid = (error: unknown) =>
  error instanceof ShopError &&
  ["invalid_state", "unsupported_schema"].includes(error.code);
const mutations: Record<string, (db: DatabaseSync) => void> = {
  "unsafe price": (db) => {
    db.prepare("UPDATE products SET price_cents=? WHERE id='mug-01'").run(
      Number.MAX_SAFE_INTEGER + 1,
    );
  },
  "fractional stock": (db) => {
    db.exec("UPDATE products SET stock=1.5 WHERE id='mug-01'");
  },
  "blank source name": (db) => {
    db.exec("UPDATE products SET name='   ' WHERE id='mug-01'");
  },
  "padded source ID": (db) => {
    db.exec("UPDATE products SET id=' bad ' WHERE id='towel-01'");
  },
  "missing catalog": (db) => {
    db.exec("DELETE FROM products");
  },
  "missing demo cart": (db) => {
    db.exec("DELETE FROM carts");
  },
  "extra cart": (db) => {
    db.exec("INSERT INTO carts VALUES('other',10000,1)");
  },
  "broken cart reference": (db) => {
    db.exec(
      "PRAGMA foreign_keys=OFF; INSERT INTO cart_lines VALUES('demo','absent',1)",
    );
  },
  "unsafe combined total": (db) => {
    db.prepare("UPDATE products SET price_cents=? WHERE id='mug-01'").run(
      Number.MAX_SAFE_INTEGER,
    );
    db.exec("INSERT INTO cart_lines VALUES('demo','mug-01',2)");
  },
  "missing instance owner": (db) => {
    db.exec("DELETE FROM shop_metadata");
  },
  "invalid instance owner": (db) => {
    db.exec("UPDATE shop_metadata SET instance_id='not-a-uuid'");
  },
  "unknown extra column": (db) => {
    db.exec("ALTER TABLE products ADD COLUMN secret TEXT");
  },
  "missing owned table": (db) => {
    db.exec("DROP TABLE cart_commands");
  },
  "unsupported version": (db) => {
    db.exec("PRAGMA user_version=4");
  },
  "unowned source trigger": (db) => {
    db.exec(
      "CREATE TRIGGER source_trigger AFTER UPDATE ON carts BEGIN UPDATE products SET stock=0; END",
    );
  },
  "wrong request index": (db) => {
    db.exec(
      "DROP INDEX orders_request; CREATE UNIQUE INDEX orders_request ON orders(id) WHERE request_id IS NOT NULL",
    );
  },
  "order total mismatch": (db) => {
    db.exec("UPDATE orders SET total_cents=1");
  },
  "invalid order timestamp": (db) => {
    db.exec("UPDATE orders SET created_at='not-a-time'");
  },
  "partial order provenance": (db) => {
    db.exec("UPDATE orders SET expected_cart_token=NULL");
  },
  "empty order lines": (db) => {
    db.exec("UPDATE orders SET lines_json='[]'");
  },
  "missing original line field": (db) => {
    const row = db.prepare("SELECT lines_json FROM orders").get() as {
      lines_json: string;
    };
    const lines = JSON.parse(row.lines_json);
    delete lines[0].stock;
    db.prepare("UPDATE orders SET lines_json=?").run(JSON.stringify(lines));
  },
  "duplicate original product": (db) => {
    const row = db.prepare("SELECT lines_json FROM orders").get() as {
      lines_json: string;
    };
    const lines = JSON.parse(row.lines_json);
    lines.push(lines[0]);
    db.prepare("UPDATE orders SET lines_json=?,total_cents=5600").run(
      JSON.stringify(lines),
    );
  },
  "order stock contradiction": (db) => {
    const row = db.prepare("SELECT lines_json FROM orders").get() as {
      lines_json: string;
    };
    const lines = JSON.parse(row.lines_json);
    lines[0].stock = 0;
    db.prepare("UPDATE orders SET lines_json=?").run(JSON.stringify(lines));
  },
  "order revision contradiction": (db) => {
    const row = db.prepare("SELECT lines_json FROM orders").get() as {
      lines_json: string;
    };
    const lines = JSON.parse(row.lines_json);
    lines[0].revision = 2;
    db.prepare("UPDATE orders SET lines_json=?").run(JSON.stringify(lines));
  },
  "stock changed without revision after an order": (db) => {
    db.exec("UPDATE products SET stock=4 WHERE id='mug-01'");
  },
  "price changed without revision after an order": (db) => {
    db.exec("UPDATE products SET price_cents=2900 WHERE id='mug-01'");
  },
  "backward original product revisions": (db) => {
    const row = db.prepare("SELECT lines_json FROM orders").get() as {
      lines_json: string;
    };
    const lines = JSON.parse(row.lines_json);
    lines[0].revision = 3;
    lines[0].stock = 6;
    db.prepare("UPDATE orders SET lines_json=?").run(JSON.stringify(lines));
    lines[0].revision = 2;
    lines[0].stock = 5;
    db.prepare(
      "INSERT INTO orders(cart_id,lines_json,total_cents,created_at) SELECT cart_id,?,total_cents,created_at FROM orders LIMIT 1",
    ).run(JSON.stringify(lines));
    db.exec("UPDATE products SET revision=5 WHERE id='mug-01'");
  },
  "duplicate historic revision": (db) => {
    db.exec(
      "INSERT INTO orders(cart_id,lines_json,total_cents,created_at) SELECT cart_id,lines_json,total_cents,created_at FROM orders LIMIT 1",
    );
  },
  "backward order time": (db) => {
    db.exec(
      "INSERT INTO orders(cart_id,lines_json,total_cents,created_at) SELECT cart_id,lines_json,total_cents,'2020-01-01T00:00:00Z' FROM orders LIMIT 1",
    );
  },
};
for (const [name, mutate] of Object.entries(mutations))
  test(`persisted ${name} is rejected without repairing original records`, (t) => {
    const path = fixture(t),
      db = new DatabaseSync(path);
    mutate(db);
    const before = JSON.stringify(
      db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),
    );
    const rows = JSON.stringify(
      db.prepare("SELECT * FROM orders ORDER BY id").all(),
    );
    assert.throws(() => new ShopStore(path), invalid);
    assert.equal(
      JSON.stringify(
        db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),
      ),
      before,
    );
    assert.equal(
      JSON.stringify(db.prepare("SELECT * FROM orders ORDER BY id").all()),
      rows,
    );
    db.close();
  });

test("open-shop reads and writes detect out-of-band invalid history before action", (t) => {
  const path = fixture(t),
    store = new ShopStore(path),
    db = new DatabaseSync(path);
  t.after(() => store.close());
  db.exec("UPDATE orders SET total_cents=1");
  const before = db.prepare("SELECT * FROM products ORDER BY id").all();
  for (const read of [
    () => store.state(),
    () => store.products(),
    () => store.product("mug-01"),
    () => store.alternatives("towel-01"),
    () => store.orders(),
    () => store.add("mug-01", 1, 2),
  ])
    assert.throws(read, invalid);
  assert.deepEqual(
    db.prepare("SELECT * FROM products ORDER BY id").all(),
    before,
  );
  assert.equal(db.prepare("SELECT * FROM cart_lines").all().length, 0);
  db.close();
});

test("over-budget and unavailable changed-source carts remain inspectable conflicts", (t) => {
  const path = fixture(t),
    db = new DatabaseSync(path);
  db.exec(
    "INSERT INTO cart_lines VALUES('demo','bottle-01',2); UPDATE products SET stock=0,revision=2 WHERE id='bottle-01'; UPDATE carts SET budget_cents=100",
  );
  db.close();
  const store = new ShopStore(path);
  t.after(() => store.close());
  assert.equal(store.state().remaining_cents, -6300);
  assert.equal(store.state().cart[0].stock, 0);
  assert.throws(
    () =>
      store.checkout({
        request_id: randomUUID(),
        expected_cart_token: store.state().checkout_token,
      }),
    (error) => error instanceof ShopError && error.code === "over_budget",
  );
  assert.equal(store.remove("bottle-01").cart.length, 0);
  assert.equal(store.orders().length, 1);
});

test("retired historic products retain original names/prices/unknown request provenance", (t) => {
  const path = fixture(t),
    db = new DatabaseSync(path);
  const row = db.prepare("SELECT lines_json FROM orders").get() as {
    lines_json: string;
  };
  const lines = JSON.parse(row.lines_json);
  lines[0].product_id = "retired-mug";
  lines[0].name = "Original hand-fired mug";
  db.prepare(
    "UPDATE orders SET id=17,lines_json=?,request_id=NULL,expected_cart_token=NULL",
  ).run(JSON.stringify(lines));
  db.close();
  const store = new ShopStore(path);
  t.after(() => store.close());
  assert.equal(store.orders()[0].id, 17);
  assert.equal(store.orders()[0].lines_json, JSON.stringify(lines));
  assert.equal(store.orders()[0].request_id, null);
});

test("a declared revision gap preserves current restocked/renamed facts without inventing intervening events", (t) => {
  const path = fixture(t),
    db = new DatabaseSync(path);
  db.exec(
    "UPDATE products SET stock=10,revision=4,name='Current mug',price_cents=3100 WHERE id='mug-01'",
  );
  db.close();
  const store = new ShopStore(path);
  t.after(() => store.close());
  assert.equal(store.product("mug-01")!.stock, 10);
  assert.equal(
    JSON.parse(store.orders()[0].lines_json)[0].name,
    "Stoneware mug",
  );
});

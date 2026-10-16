import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { cartHandler } from "../lib/cart-api";
import { type CartCommand } from "../lib/cart-contracts";
import { money } from "../lib/money";
import { ShopStore, ShopError } from "../lib/store";

function fixture(t: { after: (work: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "firedrill-cart-")),
    path = join(root, "shop.db"),
    store = new ShopStore(path);
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { path, store };
}
const add = (store: ShopStore): CartCommand => ({
  action: "add",
  product_id: "mug-01",
  quantity: 1,
  revision: store.product("mug-01")!.revision,
  request_id: randomUUID(),
  expected_shop_token: store.state().shop_token,
});
const remove = (store: ShopStore): CartCommand => ({
  action: "remove",
  product_id: "mug-01",
  request_id: randomUUID(),
  expected_shop_token: store.state().shop_token,
});
const rejects = (code: string) => (error: unknown) =>
  error instanceof ShopError && error.code === code;

test("original add recovery preserves a later bag and never applies its quantity again", (t) => {
  const { store } = fixture(t),
    intent = add(store),
    first = store.command(intent);
  store.checkout({
    request_id: randomUUID(),
    expected_cart_token: store.state().checkout_token,
  });
  store.add("bottle-01", 1, 1);
  const before = store.snapshot();
  const replay = store.command(intent);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.effect, first.effect);
  assert.equal(replay.created_at, first.created_at);
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(replay.state, before.state);
});

test("delayed remove recovery cannot delete a later entry of the same product", (t) => {
  const { store } = fixture(t);
  store.add("mug-01", 1, 1);
  const intent = remove(store),
    first = store.command(intent);
  store.add("mug-01", 1, 1);
  const before = store.snapshot(),
    replay = store.command(intent);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.effect, first.effect);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(replay.state.cart[0].quantity, 1);
});

test("bag request identity rejects changed payload but accepts reordered exact keys", (t) => {
  const { store } = fixture(t),
    intent = add(store);
  store.command(intent);
  assert.equal(
    store.command(
      Object.fromEntries(Object.entries(intent).reverse()) as CartCommand,
    ).replayed,
    true,
  );
  const before = store.snapshot();
  assert.throws(
    () => store.command({ ...intent, product_id: "bottle-01" }),
    rejects("request_reused"),
  );
  assert.throws(
    () => store.command({ ...intent, request_id: randomUUID() }),
    rejects("stale_shop"),
  );
  assert.deepEqual(store.snapshot(), before);
});

test("shop token binds target catalog price even without a product revision change and binds private instance", (t) => {
  const { path, store } = fixture(t),
    other = fixture(t),
    intent = add(store);
  assert.throws(() => other.store.command(intent), rejects("stale_shop"));
  const db = new DatabaseSync(path);
  db.prepare("UPDATE products SET price_cents=2900 WHERE id='mug-01'").run();
  db.close();
  const before = store.snapshot();
  assert.throws(() => store.command(intent), rejects("stale_shop"));
  assert.deepEqual(store.snapshot(), before);
});

test("precommit bag cancellation rolls back command receipt, cart and revision together", (t) => {
  const { store } = fixture(t),
    before = store.snapshot();
  let calls = 0;
  assert.throws(
    () =>
      store.command(add(store), () => {
        if (++calls === 2)
          throw new ShopError("cancelled", "Synthetic precommit cancellation");
      }),
    rejects("cancelled"),
  );
  assert.deepEqual(store.snapshot(), before);
});

test("strict bag HTTP rejects missing, extra, fractional and padded intents before store access", async (t) => {
  const { store } = fixture(t),
    intent = add(store);
  let opened = 0;
  const post = cartHandler(() => {
    opened++;
    return store;
  });
  for (const body of [
    { action: "remove", product_id: "mug-01" },
    { ...intent, quantity: 1.5 },
    { ...intent, request_id: " padded " },
    { ...intent, checkout: true },
  ]) {
    assert.equal(
      (
        await post(
          new Request("http://localhost/api/cart", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        )
      ).status,
      400,
    );
  }
  assert.equal(opened, 0);
});

test("bag HTTP lost acknowledgement recovers immutable effect with current bag", async (t) => {
  const { store } = fixture(t),
    intent = add(store),
    original = store.command.bind(store);
  store.command = (input, guard) => {
    original(input, guard);
    throw new Error("Synthetic postcommit failure");
  };
  const post = cartHandler(() => store),
    request = () =>
      new Request("http://localhost/api/cart", {
        method: "POST",
        body: JSON.stringify(intent),
      });
  assert.equal((await post(request())).status, 500);
  store.command = original;
  store.add("bottle-01", 1, 1);
  const before = store.snapshot(),
    result = await (await post(request())).json();
  assert.equal(result.replayed, true);
  assert.equal(result.effect.after_quantity, 1);
  assert.equal(result.state.cart.length, 2);
  assert.deepEqual(store.snapshot(), before);
});

async function worker(path: string, t: { after: (work: () => void) => void }) {
  const child = fork(resolve("test/helpers/cart-worker.ts"), [path], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  t.after(() => {
    if (child.connected) child.kill();
  });
  await new Promise<void>((resolve, reject) => {
    child.once("message", () => resolve());
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code) reject(new Error(`Worker exit ${code}`));
    });
  });
  return child;
}
function execute(child: ChildProcess, kind: string, intent: unknown) {
  return new Promise<any>((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.send({ kind, intent });
  });
}
for (const kind of ["cart", "checkout"])
  test(
    `competing processes recover one ${kind} intent exactly once`,
    { timeout: 10000 },
    async (t) => {
      const { path, store } = fixture(t);
      if (kind === "checkout") store.add("mug-01", 1, 1);
      const intent =
        kind === "cart"
          ? add(store)
          : {
              request_id: randomUUID(),
              expected_cart_token: store.state().checkout_token,
            };
      const children = await Promise.all([worker(path, t), worker(path, t)]);
      const results = await Promise.all(
        children.map((child) => execute(child, kind, intent)),
      );
      assert.ok(
        results.every((value) => value.ok),
        JSON.stringify(results),
      );
      assert.deepEqual(results.map((value) => value.result.replayed).sort(), [
        false,
        true,
      ]);
      if (kind === "cart") {
        assert.equal(store.state().cart[0].quantity, 1);
        assert.equal(store.snapshot().cart_commands.length, 1);
      } else {
        assert.equal(store.orders().length, 1);
        assert.equal(store.product("mug-01")!.stock, 3);
        assert.equal(results[0].result.order_id, results[1].result.order_id);
      }
    },
  );

test("malformed or incoherent immutable bag acknowledgement cannot be replayed as success", (t) => {
  const { store, path } = fixture(t),
    intent = add(store);
  store.command(intent);
  const db = new DatabaseSync(path);
  db.prepare("UPDATE cart_commands SET effect_json=?").run(
    JSON.stringify({ request_id: intent.request_id }),
  );
  assert.throws(() => store.command(intent), rejects("invalid_state"));
  db.close();
});

test("minor-unit currency keeps every cent at both safe-integer boundaries", () => {
  assert.equal(money(Number.MAX_SAFE_INTEGER), "$90,071,992,547,409.91");
  assert.equal(money(-Number.MAX_SAFE_INTEGER), "-$90,071,992,547,409.91");
  assert.equal(money(1), "$0.01");
  assert.equal(money(0), "$0.00");
  assert.throws(() => money(1.2));
});

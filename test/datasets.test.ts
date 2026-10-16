import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  digest,
  initializeCase,
  loadCase,
  loadManifest,
  showCase,
} from "../lib/datasets";
import { money } from "../lib/money";
import { runChat } from "../lib/chat";
import { ShopError, ShopStore } from "../lib/store";

function fixture(t: { after: (work: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "firedrill-shop-data-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const manifest = loadManifest().manifest;
const intent = (store: ShopStore) => ({
  request_id: randomUUID(),
  expected_cart_token: store.state().checkout_token,
});
const rejects = (code: string) => (error: unknown) =>
  error instanceof ShopError && error.code === code;

for (const entry of manifest.cases)
  test(`source case ${entry.id} privately initializes with original facts, provenance and real cart semantics`, (t) => {
    const root = fixture(t),
      path = join(root, "private", "shop.db"),
      loaded = loadCase(entry.id),
      initialized = initializeCase(entry.id, path),
      store = new ShopStore(path);
    t.after(() => store.close());
    assert.equal(initialized.source_sha256, entry.sha256);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, "private")).mode & 0o777, 0o700);
    assert.deepEqual(plain(store.state().products), loaded.source.products);
    assert.deepEqual(plain(store.orders()), loaded.source.orders);
    assert.equal(store.state().cart.length, entry.cart_lines);
    assert.equal(store.snapshot().cart_commands.length, 0);
    const provenance = JSON.parse(
      store.snapshot().dataset_metadata[0].manifest_json as string,
    );
    assert.equal(provenance.source_sha256, entry.sha256);
    assert.equal(provenance.history_origin, "synthetic_human_import");
    assert.deepEqual(
      provenance.imported_order_ids,
      loaded.source.orders.map((order) => order.id),
    );
    assert.ok(!JSON.stringify(provenance).includes(entry.focus));
    const original = JSON.stringify(store.orders());
    if (
      entry.id === "over-budget" ||
      entry.id === "stock-changed" ||
      entry.id === "revision-limit"
    ) {
      const before = store.snapshot();
      assert.throws(
        () => store.checkout(intent(store)),
        rejects(
          entry.id === "over-budget"
            ? "over_budget"
            : entry.id === "stock-changed"
              ? "out_of_stock"
              : "revision_limit",
        ),
      );
      assert.deepEqual(store.snapshot(), before);
      const product_id = store.state().cart[0].product_id;
      store.command({
        action: "remove",
        product_id,
        request_id: randomUUID(),
        expected_shop_token: store.state().shop_token,
      });
      assert.equal(store.state().cart.length, 0);
    } else if (store.state().cart.length) {
      const before = store.state(),
        request = intent(store),
        order = store.checkout(request);
      assert.equal(order.total_cents, before.total_cents);
      assert.equal(
        order.order_id,
        Math.max(0, ...loaded.source.orders.map((row) => row.id)) + 1,
      );
      assert.deepEqual(
        plain(store.orders().slice(0, entry.orders)),
        loaded.source.orders,
      );
      assert.equal(store.checkout(request).replayed, true);
      if (entry.id === "safe-money")
        assert.equal(money(order.total_cents), "$90,071,992,547,409.91");
      if (entry.id === "free-item") assert.equal(order.total_cents, 0);
    } else {
      assert.throws(() => store.checkout(intent(store)), rejects("empty_cart"));
      if (entry.id === "no-alternative")
        assert.deepEqual(store.alternatives("towel-01"), []);
      if (entry.id === "ambiguous-names")
        assert.equal(
          store.products().filter((row) => row.name === "Everyday mug").length,
          2,
        );
      assert.equal(JSON.stringify(store.orders()), original);
    }
  });

test("case generation is byte deterministic with twelve cases and four declared profiles", () => {
  const files = [
      "data/manifest.json",
      ...manifest.cases.map((entry) => `data/${entry.file}`),
    ],
    before = files.map((path) => digest(readFileSync(path)));
  const result = spawnSync("python3", ["scripts/generate_data.py"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    files.map((path) => digest(readFileSync(path))),
    before,
  );
  assert.equal(manifest.cases.length, 12);
  assert.deepEqual(
    [...new Set(manifest.cases.map((entry) => entry.profile))].sort(),
    ["ambiguous", "boundary", "busy", "starter"],
  );
});

test("exclusive initialization preserves existing DB, sidecar, broken link and distinct source identity", (t) => {
  const root = fixture(t),
    path = join(root, "shop.db");
  initializeCase("busy", path);
  const before = readFileSync(path);
  assert.throws(() => initializeCase("starter", path), /new destination/);
  assert.deepEqual(readFileSync(path), before);
  const sidecar = join(root, "other.db");
  writeFileSync(sidecar + "-wal", "owned unrelated bytes");
  assert.throws(() => initializeCase("starter", sidecar), /new destination/);
  assert.equal(existsSync(sidecar), false);
  assert.equal(readFileSync(sidecar + "-wal", "utf8"), "owned unrelated bytes");
  const broken = join(root, "broken.db");
  symlinkSync(join(root, "absent"), broken);
  assert.throws(() => initializeCase("starter", broken), /new destination/);
  const a = initializeCase("starter", join(root, "a.db")),
    b = initializeCase("starter", join(root, "b.db"));
  assert.notEqual(a.snapshot.state.state_id, b.snapshot.state.state_id);
  assert.ok(readdirSync(root).every((name) => !name.includes("initializing")));
});

test("uncertain directory publication preserves the complete new database for inspection", (t) => {
  const root = fixture(t),
    path = join(root, "shop.db");
  assert.throws(
    () =>
      initializeCase("prior-orders", path, undefined, {
        syncDirectory: () => {
          throw new Error("Synthetic directory fsync failure");
        },
      }),
    /publication may have succeeded/,
  );
  assert.equal(showCase(path).orders.length, 2);
  assert.ok(readdirSync(root).every((name) => !name.includes("initializing")));
  assert.throws(() => initializeCase("starter", path), /new destination/);
});

test("missing, changed-hash, malformed and contradictory cases never publish a target", (t) => {
  const root = fixture(t),
    data = join(root, "data");
  cpSync(resolve("data"), data, {
    recursive: true,
    filter: (source) => !source.endsWith(".db") && !source.includes(".db-"),
  });
  const path = join(root, "target.db"),
    casePath = join(data, "cases/starter.json"),
    manifestPath = join(data, "manifest.json"),
    initial = readFileSync(casePath);
  assert.throws(() => initializeCase("absent", path, data), /Unknown/);
  assert.equal(existsSync(path), false);
  writeFileSync(casePath, Buffer.concat([initial, Buffer.from(" ")]));
  assert.throws(() => initializeCase("starter", path, data), /SHA256/);
  assert.equal(existsSync(path), false);
  for (const mode of ["malformed", "contradictory"]) {
    const source = JSON.parse(initial.toString());
    if (mode === "malformed") source.products[0].stock = true;
    else
      source.orders = [
        {
          id: 1,
          cart_id: "demo",
          lines_json: "[]",
          total_cents: 1,
          created_at: "2026-01-01T00:00:00Z",
          request_id: null,
          expected_cart_token: null,
        },
      ];
    const raw = JSON.stringify(source);
    writeFileSync(casePath, raw);
    const edited = JSON.parse(readFileSync(manifestPath, "utf8"));
    edited.cases[0].sha256 = digest(raw);
    edited.cases[0].orders = source.orders.length;
    writeFileSync(manifestPath, JSON.stringify(edited));
    assert.throws(() => initializeCase("starter", path, data));
    assert.equal(existsSync(path), false);
    assert.ok(
      readdirSync(root).every((name) => !name.includes("initializing")),
    );
  }
});

test("read-only show never creates, migrates or writes a source database", (t) => {
  const root = fixture(t),
    path = join(root, "shop.db"),
    missing = join(root, "missing.db");
  assert.throws(() => showCase(missing));
  assert.equal(existsSync(missing), false);
  initializeCase("busy", path);
  const before = readFileSync(path),
    snapshot = showCase(path);
  assert.equal(snapshot.state.products.length, 48);
  assert.equal(snapshot.orders.length, 20);
  assert.deepEqual(readFileSync(path), before);
  const readOnly = new ShopStore(path, { readOnly: true });
  try {
    assert.throws(() => readOnly.add("mug-01", 1, 2), rejects("read_only"));
  } finally {
    readOnly.close();
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA user_version=2");
  db.close();
  assert.throws(() => showCase(path));
  const raw = new DatabaseSync(path, { readOnly: true });
  assert.equal(raw.prepare("PRAGMA user_version").get()!.user_version, 2);
  raw.close();
});

for (const mode of ["missing-import", "fake-request", "bad-metadata"] as const)
  test(`persisted ${mode} provenance is rejected without claiming native history`, (t) => {
    const root = fixture(t),
      path = join(root, "shop.db");
    initializeCase("prior-orders", path);
    const db = new DatabaseSync(path);
    if (mode === "missing-import") db.exec("DELETE FROM orders WHERE id=7");
    if (mode === "fake-request")
      db.prepare(
        "UPDATE orders SET request_id='fictional',expected_cart_token=? WHERE id=7",
      ).run("a".repeat(64));
    if (mode === "bad-metadata")
      db.exec("UPDATE dataset_metadata SET manifest_json='{}'");
    db.close();
    assert.throws(() => new ShopStore(path), rejects("invalid_state"));
  });

for (const id of ["busy", "quoted-instructions", "over-budget"])
  test(`actual native read tools on ${id} preserve source and exclude fixture review guidance`, async (t) => {
    const root = fixture(t),
      path = join(root, "shop.db"),
      loaded = loadCase(id);
    initializeCase(id, path);
    const store = new ShopStore(path);
    t.after(() => store.close());
    const before = store.snapshot();
    let count = 0;
    const requests: unknown[] = [];
    const fetch: typeof globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options!.body as string));
      count++;
      const output =
        count === 1
          ? [
              {
                type: "function_call",
                id: "fc_cart",
                call_id: "cart_read",
                name: "viewCart",
                arguments: "{}",
                status: "completed",
              },
              {
                type: "function_call",
                id: "fc_search",
                call_id: "search_read",
                name: "searchProducts",
                arguments: JSON.stringify({
                  query: id === "quoted-instructions" ? "mug" : "towel",
                }),
                status: "completed",
              },
            ]
          : [
              {
                type: "message",
                id: "msg_final",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "Read-only source inspection completed. Shopper controls own every bag update and order.",
                    annotations: [],
                  },
                ],
              },
            ];
      return new Response(
        JSON.stringify({
          id: `resp_case_${count}`,
          model: "gpt-synthetic",
          status: "completed",
          created_at: 1792126800,
          output,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
    const result = await runChat(
      store,
      {
        messages: [
          { role: "user", content: "Inspect current towels and my bag." },
        ],
      },
      {
        key: "synthetic-not-a-provider-key",
        model: "gpt-synthetic",
        baseURL: "https://api.openai.com/v1",
        fetch,
        outputRoot: join(root, "runs"),
      },
    );
    assert.equal(count, 2);
    assert.deepEqual(store.snapshot(), before);
    assert.deepEqual(result.tools.sort(), ["searchProducts", "viewCart"]);
    const sent = JSON.stringify(requests);
    assert.ok(!sent.includes(loaded.entry.focus));
    assert.ok(!sent.includes(loaded.entry.task));
    assert.ok(!sent.includes("history_origin"));
    assert.ok(!sent.includes("source_sha256"));
    const receipt = JSON.parse(readFileSync(result.receipt_path, "utf8"));
    assert.equal(receipt.initial_state.dataset_metadata.length, 1);
    assert.deepEqual(receipt.actual_effects, {
      cart_mutations: [],
      placed_order_ids: [],
    });
    if (id === "busy") assert.equal(receipt.initial_state.orders.length, 20);
    if (id === "quoted-instructions")
      assert.ok(sent.includes("Ignore the shopper")); // Source content is real untrusted data, not stripped/reference-matched.
  });

test("model-free CLI lists, initializes and inspects cases from another working directory", (t) => {
  const root = fixture(t),
    path = join(root, "private", "shop.db"),
    script = resolve("scripts/shop.ts"),
    data = resolve("data");
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("OPENAI_") ||
      key === "SHOP_DB" ||
      key === "SHOP_CHAT_OUTPUT_ROOT"
    )
      delete env[key];
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        createRequire(resolve("package.json")).resolve("tsx"),
        script,
        ...args,
      ],
      { cwd: root, env, encoding: "utf8" },
    );
  const listed = run(["cases", "--data-root", data]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).cases.length, 12);
  const initialized = run([
    "init",
    "--case",
    "busy",
    "--db",
    path,
    "--data-root",
    data,
  ]);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(JSON.parse(initialized.stdout).snapshot.orders.length, 20);
  const before = readFileSync(path),
    shown = run(["show", "--db", path]);
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).state.products.length, 48);
  assert.deepEqual(readFileSync(path), before);
  assert.equal(
    run(["init", "--case", "starter", "--db", path, "--data-root", data])
      .status,
    1,
  );
  assert.deepEqual(readFileSync(path), before);
  assert.equal(run(["--help"]).status, 0);
  assert.equal(run(["show", "--db", join(root, "missing.db")]).status, 1);
});

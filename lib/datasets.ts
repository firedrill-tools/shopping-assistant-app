import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  datasetProvenanceSchema,
  orderSchema,
  productSchema,
  validateShop,
} from "./shop-schemas";
import { ShopStore } from "./store";

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const caseId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = z
  .string()
  .min(1)
  .max(4000)
  .refine((value) => Boolean(value.trim()));
const entrySchema = z
  .strictObject({
    id: caseId,
    profile: z.enum(["starter", "busy", "ambiguous", "boundary"]),
    file: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    task: text,
    focus: text,
    products: integer.min(1).max(1000),
    cart_lines: integer.max(1000),
    orders: integer.max(1000),
  })
  .refine((value) => value.file === `cases/${value.id}.json`);
const manifestSchema = z
  .strictObject({
    id: z.literal("synthetic-shopping"),
    version: z.literal(1),
    synthetic: z.literal(true),
    cases: z.array(entrySchema).min(1).max(1000),
  })
  .refine(
    (value) =>
      new Set(value.cases.map((item) => item.id)).size === value.cases.length,
    "Case IDs must be unique",
  );
const sourceSchema = z.strictObject({
  schema_version: z.literal(1),
  case_id: caseId,
  history_origin: z.literal("synthetic_human_import"),
  products: z.array(productSchema).min(1).max(1000),
  carts: z
    .array(
      z.strictObject({
        id: z.literal("demo"),
        budget_cents: integer,
        revision: integer.min(1),
      }),
    )
    .length(1),
  cart_lines: z
    .array(
      z.strictObject({
        cart_id: z.literal("demo"),
        product_id: z.string().min(1).max(100),
        quantity: integer.min(1),
      }),
    )
    .max(1000),
  orders: z.array(orderSchema).max(1000),
});
export const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
function read(path: string) {
  const info = lstatSync(path);
  if (!info.isFile() || info.size > 2097152)
    throw new Error("Case/manifest must be a regular file of at most 2 MiB");
  const bytes = readFileSync(path);
  return {
    bytes,
    value: JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)),
  };
}
export function loadManifest(dataRoot = resolve("data")) {
  const root = realpathSync(dataRoot),
    raw = read(join(root, "manifest.json"));
  return {
    root,
    manifest: manifestSchema.parse(raw.value),
    sha256: digest(raw.bytes),
  };
}
export function loadCase(id: string, dataRoot?: string) {
  const loaded = loadManifest(dataRoot),
    entry = loaded.manifest.cases.find((item) => item.id === id);
  if (!entry) throw new Error("Unknown source case");
  const path = realpathSync(join(loaded.root, entry.file));
  if (!path.startsWith(loaded.root + sep))
    throw new Error("Source case escapes its dataset directory");
  const raw = read(path);
  if (digest(raw.bytes) !== entry.sha256)
    throw new Error("Source case SHA256 disagrees with its manifest");
  const source = sourceSchema.parse(raw.value);
  if (
    source.case_id !== id ||
    source.products.length !== entry.products ||
    source.cart_lines.length !== entry.cart_lines ||
    source.orders.length !== entry.orders
  )
    throw new Error("Source case identity/counts disagree with its manifest");
  if (
    source.orders.some(
      (order) =>
        order.request_id !== null || order.expected_cart_token !== null,
    )
  )
    throw new Error(
      "Imported synthetic human history must not invent request provenance",
    );
  return { ...loaded, entry, source };
}
const syncFile = (path: string) => {
  const file = openSync(path, "r");
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
};
export function initializeCase(
  id: string,
  destination: string,
  dataRoot?: string,
  options: { syncDirectory?: (path: string) => void } = {},
) {
  const loaded = loadCase(id, dataRoot),
    path = resolve(destination),
    parent = dirname(path);
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    if (
      existsSync(path + suffix) ||
      (() => {
        try {
          lstatSync(path + suffix);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      })()
    )
      throw new Error(
        "Initialization requires a new destination without existing DB/sidecars",
      );
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staged = join(
    parent,
    `.${path.split(sep).at(-1)}.${randomUUID()}.initializing`,
  );
  let published = false;
  try {
    const starter = new ShopStore(staged);
    starter.close();
    const db = new DatabaseSync(staged);
    try {
      db.exec(
        "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=100; BEGIN IMMEDIATE; DELETE FROM cart_commands; DELETE FROM cart_lines; DELETE FROM orders; DELETE FROM sqlite_sequence WHERE name='orders'; DELETE FROM products; DELETE FROM carts;",
      );
      const products = db.prepare("INSERT INTO products VALUES(?,?,?,?,?,?,?)");
      for (const item of loaded.source.products)
        products.run(
          item.id,
          item.name,
          item.category,
          item.description,
          item.price_cents,
          item.stock,
          item.revision,
        );
      const cart = loaded.source.carts[0];
      db.prepare("INSERT INTO carts VALUES(?,?,?)").run(
        cart.id,
        cart.budget_cents,
        cart.revision,
      );
      for (const item of loaded.source.cart_lines)
        db.prepare("INSERT INTO cart_lines VALUES(?,?,?)").run(
          item.cart_id,
          item.product_id,
          item.quantity,
        );
      for (const item of loaded.source.orders)
        db.prepare(
          "INSERT INTO orders(id,cart_id,lines_json,total_cents,created_at,request_id,expected_cart_token) VALUES(?,?,?,?,?,?,?)",
        ).run(
          item.id,
          item.cart_id,
          item.lines_json,
          item.total_cents,
          item.created_at,
          item.request_id,
          item.expected_cart_token,
        );
      const provenance = datasetProvenanceSchema.parse({
        dataset_id: loaded.manifest.id,
        version: loaded.manifest.version,
        case_id: id,
        source_sha256: loaded.entry.sha256,
        manifest_sha256: loaded.sha256,
        initialized_at: new Date().toISOString(),
        history_origin: loaded.source.history_origin,
        imported_order_ids: loaded.source.orders.map((order) => order.id),
        original_counts: {
          products: loaded.source.products.length,
          cart_lines: loaded.source.cart_lines.length,
          orders: loaded.source.orders.length,
        },
      });
      db.exec(
        "CREATE TABLE dataset_metadata(id INTEGER PRIMARY KEY CHECK(id=1),manifest_json TEXT NOT NULL)",
      );
      db.prepare("INSERT INTO dataset_metadata VALUES(1,?)").run(
        JSON.stringify(provenance),
      );
      validateShop(db);
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
    syncFile(staged);
    // Atomic exclusive publication: a concurrent existing destination is never replaced.
    linkSync(staged, path);
    published = true;
    (options.syncDirectory ?? syncFile)(parent);
    const store = new ShopStore(path, { readOnly: true });
    try {
      return {
        path,
        source_sha256: loaded.entry.sha256,
        manifest_sha256: loaded.sha256,
        snapshot: store.snapshot(),
      };
    } finally {
      store.close();
    }
  } catch (error) {
    if (published)
      throw new Error(
        "Case publication may have succeeded; inspect the existing destination before retrying",
        { cause: error },
      );
    throw error;
  } finally {
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(staged + suffix, { force: true });
  }
}
export function showCase(path: string) {
  if (!lstatSync(path).isFile())
    throw new Error("Inspect an existing regular shop DB");
  const store = new ShopStore(path, { readOnly: true });
  try {
    return store.snapshot();
  } finally {
    store.close();
  }
}

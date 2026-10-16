import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { cartCommandInput, cartCommandKey, cartEffect } from "./cart-contracts";
import { ShopError } from "./shop-error";

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = integer.min(1);
const exactId = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value),
  );
const text = z
  .string()
  .min(1)
  .max(2000)
  .refine((value) => Boolean(value.trim()));
export const productSchema = z.strictObject({
  id: exactId,
  name: text,
  category: text,
  description: text,
  price_cents: integer,
  stock: integer,
  revision: positive,
});
export const lineSchema = z.strictObject({
  product_id: exactId,
  name: text,
  quantity: positive,
  price_cents: integer,
  stock: integer,
  revision: positive,
});
const timestamp = z.string().refine((value) => {
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().replace(".000Z", "Z") ===
      value.replace(".000Z", "Z")
  );
}, "UTC timestamp required");
const token = z.string().regex(/^[a-f0-9]{64}$/);
const orderSchema = z.strictObject({
  id: positive,
  cart_id: z.literal("demo"),
  lines_json: z.string().min(1).max(1048576),
  total_cents: integer,
  created_at: timestamp,
  request_id: exactId.nullable(),
  expected_cart_token: token.nullable(),
});
const commandSchema = z.strictObject({
  request_id: exactId,
  intent_json: z.string().min(1).max(8000),
  effect_json: z.string().min(1).max(8000),
  created_at: timestamp,
});
const columns: Record<string, Record<string, string>> = {
  products: {
    id: "TEXT",
    name: "TEXT",
    category: "TEXT",
    description: "TEXT",
    price_cents: "INTEGER",
    stock: "INTEGER",
    revision: "INTEGER",
  },
  carts: { id: "TEXT", budget_cents: "INTEGER", revision: "INTEGER" },
  cart_lines: { cart_id: "TEXT", product_id: "TEXT", quantity: "INTEGER" },
  orders: {
    id: "INTEGER",
    cart_id: "TEXT",
    lines_json: "TEXT",
    total_cents: "INTEGER",
    created_at: "TEXT",
    request_id: "TEXT",
    expected_cart_token: "TEXT",
  },
  shop_metadata: { id: "INTEGER", instance_id: "TEXT" },
  cart_commands: {
    request_id: "TEXT",
    intent_json: "TEXT",
    effect_json: "TEXT",
    created_at: "TEXT",
  },
};
function requireState(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ShopError("invalid_state", message);
}
function parse<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const result = schema.safeParse(value);
  requireState(result.success, `Invalid persisted ${name}`);
  return result.data;
}
export function validateCommandRecord(
  raw: unknown,
  stateId: string,
  currentRevision: number,
) {
  const record = parse(commandSchema, raw, "bag acknowledgement"),
    intent = cartCommandInput.parse(JSON.parse(record.intent_json)),
    effect = cartEffect.parse(JSON.parse(record.effect_json));
  requireState(
    cartCommandKey(intent) === record.intent_json &&
      record.request_id === intent.request_id,
    "Original bag intent is not canonical",
  );
  requireState(
    effect.request_id === intent.request_id &&
      effect.action === intent.action &&
      effect.product_id === intent.product_id &&
      effect.state_id === stateId,
    "Original bag acknowledgement does not match its intent/source",
  );
  requireState(
    effect.after_revision <= currentRevision &&
      effect.before_revision <= effect.after_revision,
    "Original bag acknowledgement exceeds current history",
  );
  const delta = BigInt(effect.after_quantity) - BigInt(effect.before_quantity),
    revisionDelta =
      BigInt(effect.after_revision) - BigInt(effect.before_revision);
  requireState(
    intent.action === "add"
      ? delta === BigInt(intent.quantity) && revisionDelta === 1n
      : effect.after_quantity === 0 &&
          revisionDelta === (effect.before_quantity > 0 ? 1n : 0n),
    "Original bag acknowledgement is incoherent",
  );
  return { record, intent, effect };
}

/** Validate actual rows and declared tables in one caller-owned SQLite transaction. */
export function validateShop(db: DatabaseSync) {
  try {
    requireState(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version === 3,
      "Shop schema version is unsupported",
    );
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    requireState(
      tables.join(",") === Object.keys(columns).sort().join(","),
      "Unexpected/missing shop tables",
    );
    requireState(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view') LIMIT 1",
        )
        .get() == null,
      "Shop triggers/views are not qualified",
    );
    for (const [table, expected] of Object.entries(columns)) {
      const actual = db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        type: string;
        pk: number;
      }[];
      requireState(
        actual.length === Object.keys(expected).length &&
          actual.every(
            (column) => expected[column.name] === column.type.toUpperCase(),
          ),
        `Unexpected ${table} columns`,
      );
      const primary = actual
        .filter((column) => column.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name)
        .join(",");
      requireState(
        primary ===
          (table === "cart_lines"
            ? "cart_id,product_id"
            : table === "cart_commands"
              ? "request_id"
              : "id"),
        `Invalid ${table} primary key`,
      );
    }
    const foreignKeys = db
      .prepare("PRAGMA foreign_key_list(cart_lines)")
      .all() as { table: string; from: string; to: string }[];
    requireState(
      foreignKeys.length === 2 &&
        foreignKeys.some(
          (row) =>
            row.table === "carts" && row.from === "cart_id" && row.to === "id",
        ) &&
        foreignKeys.some(
          (row) =>
            row.table === "products" &&
            row.from === "product_id" &&
            row.to === "id",
        ),
      "Invalid cart foreign keys",
    );
    requireState(
      db.prepare("PRAGMA foreign_key_check").all().length === 0,
      "Broken shop foreign keys",
    );
    const requestIndex = (
      db.prepare("PRAGMA index_list(orders)").all() as {
        name: string;
        unique: number;
        partial: number;
      }[]
    ).find((row) => row.name === "orders_request");
    requireState(
      requestIndex?.unique === 1 && requestIndex.partial === 1,
      "Missing unique original-order request index",
    );
    requireState(
      (
        db.prepare("PRAGMA index_info(orders_request)").all() as {
          name: string;
        }[]
      )
        .map((row) => row.name)
        .join(",") === "cart_id,request_id",
      "Original-order request index binds the wrong fields",
    );
    const productRows = db.prepare("SELECT * FROM products ORDER BY id").all();
    requireState(
      productRows.length > 0 && productRows.length <= 1000,
      "Shop needs 1–1000 products",
    );
    const products = productRows.map((row) =>
        parse(productSchema, row, "product"),
      ),
      byId = new Map(products.map((row) => [row.id, row]));
    const metadata = db.prepare("SELECT * FROM shop_metadata").all();
    requireState(metadata.length === 1, "One shop instance identity required");
    const owner = parse(
      z.strictObject({ id: z.literal(1), instance_id: z.uuid() }),
      metadata[0],
      "shop identity",
    );
    const carts = db.prepare("SELECT * FROM carts").all();
    requireState(carts.length === 1, "This local shop supports one demo cart");
    const cart = parse(
      z.strictObject({
        id: z.literal("demo"),
        budget_cents: integer,
        revision: positive,
      }),
      carts[0],
      "cart",
    );
    let total = 0n;
    for (const raw of db.prepare("SELECT * FROM cart_lines").all()) {
      const line = parse(
        z.strictObject({
          cart_id: z.literal("demo"),
          product_id: exactId,
          quantity: positive,
        }),
        raw,
        "cart line",
      );
      const product = byId.get(line.product_id);
      requireState(product, "Cart product is absent");
      total += BigInt(product.price_cents) * BigInt(line.quantity);
    }
    // Over-budget/stock carts are valid changed-source conflicts; checkout must refuse them.
    requireState(
      total <= BigInt(Number.MAX_SAFE_INTEGER),
      "Unsafe cart minor-unit total",
    );
    let previousTime = -Infinity;
    const lastLines = new Map<string, z.infer<typeof lineSchema>>();
    const revisions = new Set<string>(),
      requestIds = new Set<string>();
    const orders = db.prepare("SELECT * FROM orders ORDER BY id").all();
    requireState(
      orders.length <= 1000,
      "Order history exceeds the local 1000-order bound",
    );
    for (const raw of orders) {
      const order = parse(orderSchema, raw, "order");
      requireState(
        (order.request_id === null) === (order.expected_cart_token === null),
        "Partial original-order request provenance",
      );
      if (order.request_id !== null) {
        requireState(
          !requestIds.has(order.request_id),
          "Duplicate original-order request identity",
        );
        requestIds.add(order.request_id);
      }
      const time = Date.parse(order.created_at);
      requireState(time >= previousTime, "Order IDs/times contradict history");
      previousTime = time;
      const lines = parse(
        z.array(lineSchema).min(1).max(1000),
        JSON.parse(order.lines_json),
        "order lines",
      );
      let amount = 0n;
      const seen = new Set<string>();
      for (const line of lines) {
        requireState(
          !seen.has(line.product_id),
          "Duplicate product in original order",
        );
        seen.add(line.product_id);
        requireState(
          line.quantity <= line.stock,
          "Original order exceeds its observed stock",
        );
        amount += BigInt(line.quantity) * BigInt(line.price_cents);
        const previous = lastLines.get(line.product_id);
        if (previous) {
          requireState(
            line.revision > previous.revision,
            "Original product revisions move backward through orders",
          );
          if (BigInt(line.revision) === BigInt(previous.revision) + 1n)
            requireState(
              line.stock === previous.stock - previous.quantity &&
                line.price_cents === previous.price_cents &&
                line.name === previous.name,
              "Consecutive order revisions contradict original stock/price/name",
            );
        }
        lastLines.set(line.product_id, line);
        const current = byId.get(line.product_id);
        if (current) {
          requireState(
            line.revision < current.revision,
            "Original order revision does not precede the current product",
          );
          const key = JSON.stringify([line.product_id, line.revision]);
          requireState(
            !revisions.has(key),
            "Two orders claim the same original product revision",
          );
          revisions.add(key);
        }
      }
      requireState(
        amount <= BigInt(Number.MAX_SAFE_INTEGER) &&
          amount === BigInt(order.total_cents),
        "Original order total disagrees with its lines",
      );
    }
    for (const [id, previous] of lastLines) {
      const current = byId.get(id);
      if (
        current &&
        BigInt(current.revision) === BigInt(previous.revision) + 1n
      )
        requireState(
          current.stock === previous.stock - previous.quantity &&
            current.price_cents === previous.price_cents &&
            current.name === previous.name,
          "Current product contradicts its last consecutive order revision",
        );
    }
    const commands = db
      .prepare("SELECT * FROM cart_commands ORDER BY created_at,request_id")
      .all();
    requireState(
      commands.length <= 5000,
      "Bag history exceeds the local 5000-command bound",
    );
    const advanced = new Set<number>();
    for (const raw of commands) {
      const { effect } = validateCommandRecord(
        raw,
        owner.instance_id,
        cart.revision,
      );
      if (effect.before_revision !== effect.after_revision) {
        requireState(
          !advanced.has(effect.after_revision),
          "Bag commands claim the same revision advance",
        );
        advanced.add(effect.after_revision);
      }
    }
  } catch (error) {
    if (error instanceof ShopError) throw error;
    throw new ShopError(
      "invalid_state",
      "Shop source/history is invalid or unsupported",
    );
  }
}

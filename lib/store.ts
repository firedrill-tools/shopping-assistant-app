import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  cartCommandInput,
  cartEffect,
  cartCommandKey,
  type CartCommand,
} from "./cart-contracts";

export type Product = {
  id: string;
  name: string;
  category: string;
  description: string;
  price_cents: number;
  stock: number;
  revision: number;
};
export type CartLine = {
  product_id: string;
  name: string;
  quantity: number;
  price_cents: number;
  stock: number;
  revision: number;
};
export type ShopState = {
  products: Product[];
  cart: CartLine[];
  budget_cents: number;
  total_cents: number;
  remaining_cents: number;
  cart_id: string;
  cart_revision: number;
  checkout_token: string;
  shop_token: string;
  state_id: string;
};
export type CheckoutIntent = {
  request_id: string;
  expected_cart_token: string;
};
export type CheckoutResult = {
  order_id: number;
  request_id: string;
  expected_cart_token: string;
  replayed: boolean;
  total_cents: number;
  lines: CartLine[];
  state: ShopState;
};

type Order = {
  id: number;
  cart_id: string;
  lines_json: string;
  total_cents: number;
  created_at: string;
  request_id: string | null;
  expected_cart_token: string | null;
};

export class ShopError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function safe(
  value: unknown,
  name: string,
  minimum = 0,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new ShopError(
      "invalid_value",
      `${name} must be a safe integer >= ${minimum}`,
    );
}
function id(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > 100
  )
    throw new ShopError(
      "invalid_value",
      `${name} must contain 1–100 characters without surrounding whitespace`,
    );
}
function product(row: Product): Product {
  id(row.id, "Product ID");
  for (const key of ["name", "category", "description"] as const)
    if (
      typeof row[key] !== "string" ||
      !row[key].trim() ||
      row[key].length > 2000
    )
      throw new ShopError("invalid_state", `Invalid product ${key}`);
  safe(row.price_cents, "Price");
  safe(row.stock, "Stock");
  safe(row.revision, "Product revision", 1);
  return row;
}

const seedProducts: Omit<Product, "revision">[] = [
  {
    id: "mug-01",
    name: "Stoneware mug",
    category: "Tabletop",
    description: "Matte clay, 350 ml",
    price_cents: 2800,
    stock: 4,
  },
  {
    id: "towel-01",
    name: "Linen bath towel",
    category: "Bath",
    description: "Washed linen, natural",
    price_cents: 4200,
    stock: 0,
  },
  {
    id: "towel-02",
    name: "Cotton bath towel",
    category: "Bath",
    description: "Organic cotton, ivory",
    price_cents: 3600,
    stock: 5,
  },
  {
    id: "lamp-01",
    name: "Desk lamp",
    category: "Lighting",
    description: "Warm LED, graphite",
    price_cents: 6800,
    stock: 2,
  },
  {
    id: "lamp-02",
    name: "Portable lantern",
    category: "Lighting",
    description: "Rechargeable, sand",
    price_cents: 7400,
    stock: 2,
  },
  {
    id: "bottle-01",
    name: "Steel bottle",
    category: "Everyday",
    description: "Insulated, 500 ml",
    price_cents: 3200,
    stock: 7,
  },
];

export class ShopStore {
  private db: DatabaseSync;
  private inTransaction = false;
  private closed = false;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      closeSync(openSync(path, "wx", 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=100;");
      this.transaction(() => {
        const version = this.db.prepare("PRAGMA user_version").get() as {
          user_version: number;
        };
        if (
          version.user_version !== 0 &&
          version.user_version !== 2 &&
          version.user_version !== 3
        )
          throw new ShopError(
            "unsupported_schema",
            "Shop schema needs qualification before use",
          );
        const existing = (
          this.db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .all() as { name: string }[]
        ).map((row) => row.name);
        const required = ["products", "carts", "cart_lines", "orders"];
        if (
          existing.length &&
          (!required.every((name) => existing.includes(name)) ||
            existing.some(
              (name) =>
                ![
                  ...required,
                  "dataset_metadata",
                  "shop_metadata",
                  "cart_commands",
                ].includes(name),
            ))
        )
          throw new ShopError(
            "invalid_state",
            "Database is not an owned shop schema",
          );
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL, stock INTEGER NOT NULL, revision INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS carts (id TEXT PRIMARY KEY, budget_cents INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS cart_lines (cart_id TEXT NOT NULL REFERENCES carts(id), product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity>0), PRIMARY KEY(cart_id,product_id));
          CREATE TABLE IF NOT EXISTS shop_metadata(id INTEGER PRIMARY KEY CHECK(id=1),instance_id TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS cart_commands(request_id TEXT PRIMARY KEY,intent_json TEXT NOT NULL,effect_json TEXT NOT NULL,created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT NOT NULL, lines_json TEXT NOT NULL, total_cents INTEGER NOT NULL, created_at TEXT NOT NULL);
        `);
        const cartColumns = (
          this.db.prepare("PRAGMA table_info(carts)").all() as {
            name: string;
          }[]
        ).map((row) => row.name);
        if (!cartColumns.includes("revision"))
          this.db.exec(
            "ALTER TABLE carts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
          );
        const orderColumns = (
          this.db.prepare("PRAGMA table_info(orders)").all() as {
            name: string;
          }[]
        ).map((row) => row.name);
        if (!orderColumns.includes("request_id"))
          this.db.exec("ALTER TABLE orders ADD COLUMN request_id TEXT");
        if (!orderColumns.includes("expected_cart_token"))
          this.db.exec(
            "ALTER TABLE orders ADD COLUMN expected_cart_token TEXT",
          );
        this.db.exec(
          "CREATE UNIQUE INDEX IF NOT EXISTS orders_request ON orders(cart_id,request_id) WHERE request_id IS NOT NULL",
        );
        if (
          (
            this.db.prepare("SELECT COUNT(*) AS count FROM products").get() as {
              count: number;
            }
          ).count === 0
        ) {
          const insert = this.db.prepare(
            "INSERT INTO products VALUES (?,?,?,?,?,?,1)",
          );
          for (const row of seedProducts)
            insert.run(
              row.id,
              row.name,
              row.category,
              row.description,
              row.price_cents,
              row.stock,
            );
        }
        this.db
          .prepare(
            "INSERT OR IGNORE INTO carts(id,budget_cents,revision) VALUES ('demo',15000,1)",
          )
          .run();
        this.db
          .prepare("INSERT OR IGNORE INTO shop_metadata VALUES (1,?)")
          .run(randomUUID());
        if (this.db.prepare("PRAGMA foreign_key_check").all().length)
          throw new ShopError(
            "invalid_state",
            "Shop has broken foreign-key relationships",
          );
        this.state();
        this.db.exec("PRAGMA user_version=3");
      });
      this.db.exec("PRAGMA journal_mode=WAL");
      this.state();
    } catch (error) {
      this.db.close();
      this.closed = true;
      throw error;
    }
  }

  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }

  private transaction<T>(
    work: () => T,
    mode: "IMMEDIATE" | "DEFERRED" = "IMMEDIATE",
    guard?: () => void,
  ): T {
    guard?.();
    if (this.inTransaction)
      throw new ShopError(
        "nested_transaction",
        "Nested shop transaction is not allowed",
      );
    this.db.exec(`BEGIN ${mode}`);
    this.inTransaction = true;
    try {
      const result = work();
      guard?.();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  products(): Product[] {
    return (
      this.db
        .prepare("SELECT * FROM products ORDER BY rowid")
        .all() as Product[]
    ).map(product);
  }
  product(productId: string): Product | undefined {
    id(productId, "Product ID");
    const row = this.db
      .prepare("SELECT * FROM products WHERE id=?")
      .get(productId) as Product | undefined;
    return row && product(row);
  }
  alternatives(productId: string): Product[] {
    const target = this.product(productId);
    if (!target) throw new ShopError("not_found", "Product not found");
    return (
      this.db
        .prepare(
          "SELECT * FROM products WHERE category=? AND id!=? AND stock>0 ORDER BY price_cents,id",
        )
        .all(target.category, productId) as Product[]
    ).map(product);
  }

  private readState(): ShopState {
    const cart = this.db
      .prepare(
        `SELECT l.product_id,p.name,l.quantity,p.price_cents,p.stock,p.revision FROM cart_lines l JOIN products p ON p.id=l.product_id WHERE l.cart_id='demo' ORDER BY l.product_id`,
      )
      .all() as CartLine[];
    const current = this.db
      .prepare("SELECT budget_cents,revision FROM carts WHERE id='demo'")
      .get() as { budget_cents: number; revision: number };
    safe(current.budget_cents, "Budget");
    safe(current.revision, "Cart revision", 1);
    for (const line of cart) {
      id(line.product_id, "Product ID");
      safe(line.quantity, "Quantity", 1);
      safe(line.price_cents, "Price");
      safe(line.stock, "Stock");
      safe(line.revision, "Product revision", 1);
    }
    const total = cart.reduce(
      (sum, line) => sum + BigInt(line.price_cents) * BigInt(line.quantity),
      0n,
    );
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      throw new ShopError(
        "unsafe_total",
        "Cart total exceeds safe integer minor units",
      );
    const total_cents = Number(total);
    const { instance_id: state_id } = this.db
      .prepare("SELECT instance_id FROM shop_metadata WHERE id=1")
      .get() as { instance_id: string };
    id(state_id, "Shop state ID");
    const binding = {
      state_id,
      cart_id: "demo",
      cart_revision: current.revision,
      budget_cents: current.budget_cents,
      cart,
    };
    const checkout_token = createHash("sha256")
      .update(JSON.stringify(binding))
      .digest("hex");
    const products = this.products();
    const shop_token = createHash("sha256")
      .update(JSON.stringify({ ...binding, products }))
      .digest("hex");
    return {
      products,
      shop_token,
      cart,
      budget_cents: current.budget_cents,
      total_cents,
      remaining_cents: current.budget_cents - total_cents,
      cart_id: "demo",
      cart_revision: current.revision,
      checkout_token,
      state_id,
    };
  }
  state(): ShopState {
    return this.inTransaction
      ? this.readState()
      : this.transaction(() => this.readState(), "DEFERRED");
  }
  private advanceCart() {
    const current = this.db
      .prepare("SELECT revision FROM carts WHERE id='demo'")
      .get() as { revision: number };
    safe(current.revision, "Cart revision", 1);
    if (current.revision === Number.MAX_SAFE_INTEGER)
      throw new ShopError("revision_limit", "Cart revision limit reached");
    this.db
      .prepare("UPDATE carts SET revision=revision+1 WHERE id='demo'")
      .run();
  }

  add(
    productId: string,
    quantity: number,
    expectedRevision: number,
  ): ShopState {
    return this.transaction(() =>
      this.addWithin(productId, quantity, expectedRevision),
    );
  }
  private addWithin(
    productId: string,
    quantity: number,
    expectedRevision: number,
  ): ShopState {
    id(productId, "Product ID");
    safe(quantity, "Quantity", 1);
    safe(expectedRevision, "Expected product revision", 1);
    if (quantity > 10)
      throw new ShopError(
        "invalid_quantity",
        "Quantity must be between 1 and 10",
      );
    const row = this.product(productId);
    if (!row) throw new ShopError("not_found", "Product not found");
    if (row.revision !== expectedRevision)
      throw new ShopError(
        "stale_product",
        "Product changed; refresh before adding",
      );
    const existing = this.db
      .prepare(
        "SELECT quantity FROM cart_lines WHERE cart_id='demo' AND product_id=?",
      )
      .get(productId) as { quantity: number } | undefined;
    const nextQuantity = (existing?.quantity || 0) + quantity;
    safe(nextQuantity, "Cart quantity", 1);
    if (nextQuantity > row.stock)
      throw new ShopError(
        "out_of_stock",
        "Requested quantity exceeds current stock",
      );
    const current = this.state();
    if (
      BigInt(current.total_cents) + BigInt(row.price_cents) * BigInt(quantity) >
      BigInt(current.budget_cents)
    )
      throw new ShopError("over_budget", "Cart would exceed its budget");
    this.advanceCart();
    this.db
      .prepare(
        "INSERT INTO cart_lines VALUES ('demo',?,?) ON CONFLICT(cart_id,product_id) DO UPDATE SET quantity=excluded.quantity",
      )
      .run(productId, nextQuantity);
    return this.state();
  }
  remove(productId: string): ShopState {
    return this.transaction(() => this.removeWithin(productId));
  }
  private removeWithin(productId: string): ShopState {
    id(productId, "Product ID");
    const removed = this.db
      .prepare("DELETE FROM cart_lines WHERE cart_id='demo' AND product_id=?")
      .run(productId);
    if (removed.changes) this.advanceCart();
    return this.state();
  }

  command(value: CartCommand, guard?: () => void) {
    const parsed = cartCommandInput.safeParse(value);
    if (!parsed.success)
      throw new ShopError("invalid_request", "Invalid reviewed bag request");
    const input = parsed.data,
      canonical = cartCommandKey(input);
    return this.transaction(
      () => {
        const prior = this.db
          .prepare("SELECT * FROM cart_commands WHERE request_id=?")
          .get(input.request_id) as
          | { intent_json: string; effect_json: string; created_at: string }
          | undefined;
        if (prior) {
          if (prior.intent_json !== canonical)
            throw new ShopError(
              "request_reused",
              "Bag request ID belongs to another update; inspect its original request",
            );
          let effect;
          try {
            effect = cartEffect.parse(JSON.parse(prior.effect_json));
          } catch {
            throw new ShopError(
              "invalid_state",
              "Original bag acknowledgement is invalid",
            );
          }
          const state = this.state();
          const delta =
            BigInt(effect.after_quantity) - BigInt(effect.before_quantity);
          const revisionDelta =
            BigInt(effect.after_revision) - BigInt(effect.before_revision);
          if (
            effect.request_id !== input.request_id ||
            effect.action !== input.action ||
            effect.product_id !== input.product_id ||
            effect.state_id !== state.state_id ||
            !Number.isFinite(Date.parse(prior.created_at)) ||
            (input.action === "add"
              ? delta !== BigInt(input.quantity) || revisionDelta !== 1n
              : effect.after_quantity !== 0 ||
                revisionDelta !== (effect.before_quantity > 0 ? 1n : 0n))
          )
            throw new ShopError(
              "invalid_state",
              "Original bag acknowledgement is incoherent",
            );
          return {
            intent: input,
            effect,
            created_at: prior.created_at,
            replayed: true,
            state: this.state(),
          };
        }
        const before = this.state();
        if (input.expected_shop_token !== before.shop_token)
          throw new ShopError(
            "stale_shop",
            "Shop or bag changed; review the current view before another update",
          );
        if (
          input.action === "remove" &&
          !before.products.some((product) => product.id === input.product_id)
        )
          throw new ShopError("not_found", "Product not found");
        const after =
          input.action === "add"
            ? this.addWithin(input.product_id, input.quantity, input.revision)
            : this.removeWithin(input.product_id);
        const effect = {
          request_id: input.request_id,
          action: input.action,
          product_id: input.product_id,
          state_id: before.state_id,
          cart_id: before.cart_id,
          before_revision: before.cart_revision,
          after_revision: after.cart_revision,
          before_quantity:
            before.cart.find((line) => line.product_id === input.product_id)
              ?.quantity ?? 0,
          after_quantity:
            after.cart.find((line) => line.product_id === input.product_id)
              ?.quantity ?? 0,
        };
        const created_at = new Date().toISOString();
        this.db
          .prepare("INSERT INTO cart_commands VALUES (?,?,?,?)")
          .run(input.request_id, canonical, JSON.stringify(effect), created_at);
        return {
          intent: input,
          effect,
          created_at,
          replayed: false,
          state: after,
        };
      },
      "IMMEDIATE",
      guard,
    );
  }

  checkout(intent: CheckoutIntent, guard?: () => void): CheckoutResult {
    if (
      !intent ||
      typeof intent !== "object" ||
      Object.keys(intent).sort().join(",") !== "expected_cart_token,request_id"
    )
      throw new ShopError(
        "invalid_request",
        "Checkout requires an exact reviewed-cart token and request ID",
      );
    id(intent.request_id, "Checkout request ID");
    if (
      typeof intent.expected_cart_token !== "string" ||
      !/^[a-f0-9]{64}$/.test(intent.expected_cart_token)
    )
      throw new ShopError("invalid_request", "Reviewed-cart token is invalid");
    return this.transaction(
      () => {
        const prior = this.db
          .prepare("SELECT * FROM orders WHERE cart_id='demo' AND request_id=?")
          .get(intent.request_id) as Order | undefined;
        if (prior) {
          if (prior.expected_cart_token !== intent.expected_cart_token)
            throw new ShopError(
              "request_reused",
              "Checkout request ID was used with another cart; inspect the original order",
            );
          return {
            order_id: prior.id,
            request_id: intent.request_id,
            expected_cart_token: intent.expected_cart_token,
            replayed: true,
            total_cents: prior.total_cents,
            lines: JSON.parse(prior.lines_json),
            state: this.state(),
          };
        }
        const snapshot = this.state();
        if (snapshot.checkout_token !== intent.expected_cart_token)
          throw new ShopError(
            "stale_cart",
            "Cart, price, stock or budget changed; review the current bag before checkout",
          );
        if (!snapshot.cart.length)
          throw new ShopError("empty_cart", "Cart is empty");
        if (snapshot.total_cents > snapshot.budget_cents)
          throw new ShopError("over_budget", "Cart exceeds budget");
        for (const line of snapshot.cart) {
          if (line.quantity > line.stock)
            throw new ShopError(
              "out_of_stock",
              `${line.name} stock changed; review cart`,
            );
          if (line.revision === Number.MAX_SAFE_INTEGER)
            throw new ShopError(
              "revision_limit",
              "Product revision limit reached",
            );
        }
        this.advanceCart();
        for (const line of snapshot.cart)
          this.db
            .prepare(
              "UPDATE products SET stock=stock-?,revision=revision+1 WHERE id=?",
            )
            .run(line.quantity, line.product_id);
        const order = this.db
          .prepare(
            "INSERT INTO orders(cart_id,lines_json,total_cents,created_at,request_id,expected_cart_token) VALUES ('demo',?,?,?,?,?)",
          )
          .run(
            JSON.stringify(snapshot.cart),
            snapshot.total_cents,
            new Date().toISOString(),
            intent.request_id,
            intent.expected_cart_token,
          );
        const orderId = Number(order.lastInsertRowid);
        safe(orderId, "Order ID", 1);
        this.db.prepare("DELETE FROM cart_lines WHERE cart_id='demo'").run();
        return {
          order_id: orderId,
          request_id: intent.request_id,
          expected_cart_token: intent.expected_cart_token,
          replayed: false,
          total_cents: snapshot.total_cents,
          lines: snapshot.cart,
          state: this.state(),
        };
      },
      "IMMEDIATE",
      guard,
    );
  }

  setStockForScenario(productId: string, stock: number): Product {
    id(productId, "Product ID");
    safe(stock, "Stock");
    return this.transaction(() => {
      const current = this.product(productId);
      if (!current) throw new ShopError("not_found", "Product not found");
      if (current.stock === stock) return current;
      if (current.revision === Number.MAX_SAFE_INTEGER)
        throw new ShopError("revision_limit", "Product revision limit reached");
      this.db
        .prepare("UPDATE products SET stock=?,revision=revision+1 WHERE id=?")
        .run(stock, productId);
      return this.product(productId)!;
    });
  }
  snapshot() {
    const read = () => ({
      state: this.state(),
      carts: this.db.prepare("SELECT * FROM carts ORDER BY id").all(),
      cart_lines: this.db
        .prepare("SELECT * FROM cart_lines ORDER BY cart_id,product_id")
        .all(),
      orders: this.orders(),
      cart_commands: this.db
        .prepare("SELECT * FROM cart_commands ORDER BY created_at,request_id")
        .all(),
      dataset_metadata: this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='dataset_metadata'",
        )
        .get()
        ? this.db.prepare("SELECT * FROM dataset_metadata ORDER BY rowid").all()
        : [],
    });
    return this.inTransaction ? read() : this.transaction(read, "DEFERRED");
  }

  orders(): Order[] {
    return this.db.prepare("SELECT * FROM orders ORDER BY id").all() as Order[];
  }
}

let defaultStore: ShopStore | undefined;
export function shop(): ShopStore {
  defaultStore ??= new ShopStore(
    process.env.SHOP_DB || join(process.cwd(), "data", "shop.db"),
  );
  return defaultStore;
}

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Product = { id: string; name: string; category: string; description: string; price_cents: number; stock: number; revision: number };
export type CartLine = { product_id: string; name: string; quantity: number; price_cents: number; stock: number; revision: number };
export type ShopState = { products: Product[]; cart: CartLine[]; budget_cents: number; total_cents: number; remaining_cents: number };

export class ShopError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const seedProducts: Omit<Product, "revision">[] = [
  { id: "mug-01", name: "Stoneware mug", category: "Tabletop", description: "Matte clay, 350 ml", price_cents: 2800, stock: 4 },
  { id: "towel-01", name: "Linen bath towel", category: "Bath", description: "Washed linen, natural", price_cents: 4200, stock: 0 },
  { id: "towel-02", name: "Cotton bath towel", category: "Bath", description: "Organic cotton, ivory", price_cents: 3600, stock: 5 },
  { id: "lamp-01", name: "Desk lamp", category: "Lighting", description: "Warm LED, graphite", price_cents: 6800, stock: 2 },
  { id: "lamp-02", name: "Portable lantern", category: "Lighting", description: "Rechargeable, sand", price_cents: 7400, stock: 2 },
  { id: "bottle-01", name: "Steel bottle", category: "Everyday", description: "Insulated, 500 ml", price_cents: 3200, stock: 7 },
];

export class ShopStore {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL,
        price_cents INTEGER NOT NULL, stock INTEGER NOT NULL, revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS carts (id TEXT PRIMARY KEY, budget_cents INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cart_lines (
        cart_id TEXT NOT NULL REFERENCES carts(id), product_id TEXT NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(cart_id, product_id)
      );
      CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT NOT NULL,
        lines_json TEXT NOT NULL, total_cents INTEGER NOT NULL, created_at TEXT NOT NULL);
    `);
    this.transaction(() => {
      if ((this.db.prepare("SELECT COUNT(*) AS count FROM products").get() as { count: number }).count === 0) {
        const insert = this.db.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,1)");
        for (const product of seedProducts) insert.run(product.id, product.name, product.category,
          product.description, product.price_cents, product.stock);
      }
      this.db.prepare("INSERT OR IGNORE INTO carts VALUES ('demo', 15000)").run();
    });
  }

  close() { this.db.close(); }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  products(): Product[] {
    return this.db.prepare("SELECT * FROM products ORDER BY rowid").all() as Product[];
  }

  product(id: string): Product | undefined {
    return this.db.prepare("SELECT * FROM products WHERE id=?").get(id) as Product | undefined;
  }

  alternatives(id: string): Product[] {
    const target = this.product(id);
    if (!target) throw new ShopError("not_found", "Product not found");
    return this.db.prepare("SELECT * FROM products WHERE category=? AND id!=? AND stock>0 ORDER BY price_cents")
      .all(target.category, id) as Product[];
  }

  state(): ShopState {
    const cart = this.db.prepare(`
      SELECT l.product_id, p.name, l.quantity, p.price_cents, p.stock, p.revision
      FROM cart_lines l JOIN products p ON p.id=l.product_id WHERE l.cart_id='demo' ORDER BY p.rowid
    `).all() as CartLine[];
    const budget_cents = (this.db.prepare("SELECT budget_cents FROM carts WHERE id='demo'").get() as { budget_cents: number }).budget_cents;
    const total_cents = cart.reduce((sum, line) => sum + line.price_cents * line.quantity, 0);
    return { products: this.products(), cart, budget_cents, total_cents,
      remaining_cents: budget_cents - total_cents };
  }

  add(productId: string, quantity: number, expectedRevision: number): ShopState {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new ShopError("invalid_quantity", "Quantity must be between 1 and 10");
    }
    return this.transaction(() => {
      const product = this.product(productId);
      if (!product) throw new ShopError("not_found", "Product not found");
      if (product.revision !== expectedRevision) throw new ShopError("stale_product", "Product changed; refresh before adding");
      const existing = this.db.prepare("SELECT quantity FROM cart_lines WHERE cart_id='demo' AND product_id=?")
        .get(productId) as { quantity: number } | undefined;
      const nextQuantity = (existing?.quantity || 0) + quantity;
      if (nextQuantity > product.stock) throw new ShopError("out_of_stock", "Requested quantity exceeds current stock");
      const current = this.state();
      if (current.total_cents + product.price_cents * quantity > current.budget_cents) {
        throw new ShopError("over_budget", "Cart would exceed the $150 budget");
      }
      this.db.prepare(`INSERT INTO cart_lines VALUES ('demo',?,?)
        ON CONFLICT(cart_id,product_id) DO UPDATE SET quantity=excluded.quantity`)
        .run(productId, nextQuantity);
      return this.state();
    });
  }

  remove(productId: string): ShopState {
    return this.transaction(() => {
      this.db.prepare("DELETE FROM cart_lines WHERE cart_id='demo' AND product_id=?").run(productId);
      return this.state();
    });
  }

  checkout(): { order_id: number; total_cents: number; lines: CartLine[]; state: ShopState } {
    return this.transaction(() => {
      const snapshot = this.state();
      if (snapshot.cart.length === 0) throw new ShopError("empty_cart", "Cart is empty");
      if (snapshot.total_cents > snapshot.budget_cents) throw new ShopError("over_budget", "Cart exceeds budget");
      for (const line of snapshot.cart) {
        if (line.quantity > line.stock) throw new ShopError("out_of_stock", `${line.name} stock changed; review cart`);
      }
      for (const line of snapshot.cart) {
        this.db.prepare("UPDATE products SET stock=stock-?, revision=revision+1 WHERE id=?")
          .run(line.quantity, line.product_id);
      }
      const order = this.db.prepare("INSERT INTO orders (cart_id,lines_json,total_cents,created_at) VALUES ('demo',?,?,?)")
        .run(JSON.stringify(snapshot.cart), snapshot.total_cents, new Date().toISOString());
      this.db.prepare("DELETE FROM cart_lines WHERE cart_id='demo'").run();
      return { order_id: Number(order.lastInsertRowid), total_cents: snapshot.total_cents,
        lines: snapshot.cart, state: this.state() };
    });
  }

  setStockForScenario(productId: string, stock: number): Product {
    if (!Number.isInteger(stock) || stock < 0) throw new ShopError("invalid_stock", "Stock must be nonnegative");
    return this.transaction(() => {
      if (!this.product(productId)) throw new ShopError("not_found", "Product not found");
      this.db.prepare("UPDATE products SET stock=?, revision=revision+1 WHERE id=?").run(stock, productId);
      return this.product(productId)!;
    });
  }
}

let defaultStore: ShopStore | undefined;
export function shop(): ShopStore {
  defaultStore ??= new ShopStore(process.env.SHOP_DB || join(process.cwd(), "data", "shop.db"));
  return defaultStore;
}

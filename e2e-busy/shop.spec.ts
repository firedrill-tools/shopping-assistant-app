import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

test.use({ baseURL: "http://127.0.0.1:3304" });
const read = () => {
  const db = new DatabaseSync(resolve(".e2e/busy.db"), { readOnly: true });
  try {
    return {
      orders: db.prepare("SELECT * FROM orders ORDER BY id").all(),
      products: db.prepare("SELECT * FROM products ORDER BY id").all(),
      cart: db.prepare("SELECT * FROM cart_lines ORDER BY product_id").all(),
    };
  } finally {
    db.close();
  }
};
test("busy production catalog, native advice and explicit shopper checkout preserve prior human orders", async ({
  page,
}, testInfo) => {
  await page.route(/^https?:/, (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const original = read();
  expect(original.orders).toHaveLength(20);
  expect(original.cart).toHaveLength(5);
  await page.goto("/");
  await expect(page.locator(".product")).toHaveCount(48);
  await expect(page.locator(".collection-head")).toContainText("48 pieces");
  await page.getByRole("button", { name: "Bath", exact: true }).click();
  await expect(page.locator(".product")).toHaveCount(16);
  await page
    .getByRole("textbox", { name: "Ask about the collection" })
    .fill("Compare current towels and inspect my bag.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".messages .assistant")).toContainText(
    "bag and orders are unchanged",
  );
  expect(read()).toEqual(original);
  const receipts = readdirSync(resolve(".e2e/busy-runs")).map((name) =>
    JSON.parse(
      readFileSync(resolve(".e2e/busy-runs", name, "receipt.json"), "utf8"),
    ),
  );
  expect(receipts).toHaveLength(1);
  expect(receipts[0].status).toBe("completed");
  expect(receipts[0].initial_state.orders).toHaveLength(20);
  expect(receipts[0].tools).toHaveLength(3);
  expect(receipts[0].actual_effects).toEqual({
    cart_mutations: [],
    placed_order_ids: [],
  });
  await page.getByRole("button", { name: "Place synthetic order" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Order 159 placed for $306.00",
  );
  const after = read();
  expect(after.orders.slice(0, 20)).toEqual(original.orders);
  expect(after.orders).toHaveLength(21);
  expect(after.cart).toHaveLength(0);
  await page.reload();
  await expect(page.locator(".product")).toHaveCount(48);
  await page.screenshot({
    path: testInfo.outputPath("busy-catalog-original-orders.png"),
    fullPage: true,
  });
});

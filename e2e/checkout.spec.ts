import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const path = resolve(".e2e/shop.db");
const read = () => {
  const db = new DatabaseSync(path);
  try {
    return {
      orders: db.prepare("SELECT * FROM orders ORDER BY id").all(),
      cart: db.prepare("SELECT * FROM cart_lines ORDER BY product_id").all(),
      products: db.prepare("SELECT * FROM products ORDER BY id").all(),
    };
  } finally {
    db.close();
  }
};

test.beforeEach(async ({ request, page }) => {
  await request.get("/api/state");
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "BEGIN IMMEDIATE;DELETE FROM cart_lines;DELETE FROM orders;DELETE FROM sqlite_sequence WHERE name='orders';UPDATE carts SET revision=1,budget_cents=15000 WHERE id='demo';",
    );
    for (const [id, price, stock] of [
      ["mug-01", 2800, 4],
      ["towel-01", 4200, 0],
      ["towel-02", 3600, 5],
      ["lamp-01", 6800, 2],
      ["lamp-02", 7400, 2],
      ["bottle-01", 3200, 7],
    ]) {
      db.prepare(
        "UPDATE products SET price_cents=?,stock=?,revision=1 WHERE id=?",
      ).run(price, stock, id);
    }
    db.prepare("UPDATE shop_metadata SET instance_id=? WHERE id=1").run(
      randomUUID(),
    );
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  await page.route(/^https?:/, (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

test("lost checkout response survives reload and recovery preserves a newer bag", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .locator(".product")
    .filter({ has: page.getByRole("heading", { name: "Stoneware mug" }) })
    .getByRole("button", { name: /Add to bag/ })
    .click();
  await expect(page.locator(".bag-lines")).toContainText("Stoneware mug");
  await page.route(
    "**/api/checkout",
    async (route) => {
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      expect((await result.json()).replayed).toBe(false);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Place synthetic order" }).click();
  await expect(
    page.getByRole("button", { name: "Check previous checkout" }),
  ).toBeEnabled();
  expect(read().orders).toHaveLength(1);
  expect(read().cart).toHaveLength(0);
  await page.reload();
  await expect(page.locator(".product")).toHaveCount(6);
  await expect(
    page.getByRole("button", { name: "Check previous checkout" }),
  ).toBeEnabled();
  await page
    .locator(".product")
    .filter({ has: page.getByRole("heading", { name: "Steel bottle" }) })
    .getByRole("button", { name: /Add to bag/ })
    .click();
  await expect(page.locator(".bag-lines")).toContainText("Steel bottle");
  const before = read();
  const recovered = page.waitForResponse((response) =>
    response.url().endsWith("/api/checkout"),
  );
  await page.getByRole("button", { name: "Check previous checkout" }).click();
  expect((await (await recovered).json()).replayed).toBe(true);
  await expect(page.getByRole("status")).toContainText("already placed");
  await expect(page.locator(".bag-lines")).toContainText("Steel bottle");
  expect(read()).toEqual(before);
  await expect(
    page.getByRole("button", { name: "Place synthetic order" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("nook.checkoutIntent")),
  ).toBeNull();
  await page.screenshot({
    path: testInfo.outputPath("recovered-original-order-new-bag.png"),
    fullPage: true,
  });
});

test("price changed after the displayed bag requires a new shopper review", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const added = page.waitForResponse((response) =>
    response.url().endsWith("/api/cart"),
  );
  await page
    .locator(".product")
    .filter({ has: page.getByRole("heading", { name: "Stoneware mug" }) })
    .getByRole("button", { name: /Add to bag/ })
    .click();
  const displayed = await (await added).json();
  await expect(page.locator(".bag-lines")).toContainText("$28.00");
  // Hold the old read view while the actual persisted price/revision changes.
  await page.route("**/api/state", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(displayed),
    }),
  );
  const db = new DatabaseSync(path);
  try {
    db.prepare(
      "UPDATE products SET price_cents=2900,revision=revision+1 WHERE id='mug-01'",
    ).run();
  } finally {
    db.close();
  }
  const checkout = page.waitForResponse((response) =>
    response.url().endsWith("/api/checkout"),
  );
  await page.getByRole("button", { name: "Place synthetic order" }).click();
  expect((await checkout).status()).toBe(409);
  await expect(page.locator(".bag-panel [role=alert]")).toContainText(
    "changed",
  );
  expect(read().orders).toHaveLength(0);
  expect(read().cart).toHaveLength(1);
  await page.unroute("**/api/state");
  expect(
    (await (await request.get("/api/state")).json()).cart[0].price_cents,
  ).toBe(2900);
  await expect(page.locator(".bag-lines")).toContainText("$29.00", {
    timeout: 8000,
  });
  await page.getByRole("button", { name: "Place synthetic order" }).click();
  await expect(page.getByRole("status")).toContainText("$29.00");
  expect(read().orders).toHaveLength(1);
  expect(read().orders[0].total_cents).toBe(2900);
});

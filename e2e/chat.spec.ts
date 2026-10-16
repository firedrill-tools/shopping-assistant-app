import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const receipts = () =>
  readdirSync(resolve(".e2e/runs")).flatMap((name) => {
    try {
      return [
        JSON.parse(
          readFileSync(resolve(".e2e/runs", name, "receipt.json"), "utf8"),
        ),
      ];
    } catch {
      return [];
    }
  });
function business() {
  const db = new DatabaseSync(resolve(".e2e/shop.db"));
  try {
    return {
      cart: db.prepare("SELECT * FROM cart_lines ORDER BY product_id").all(),
      orders: db.prepare("SELECT * FROM orders ORDER BY id").all(),
      products: db.prepare("SELECT * FROM products ORDER BY id").all(),
    };
  } finally {
    db.close();
  }
}
test.beforeEach(async ({ request, page }) => {
  await request.get("/api/state");
  rmSync(resolve(".e2e/runs"), { recursive: true, force: true });
  rmSync(resolve(".e2e/provider-log.jsonl"), { force: true });
  await page.route(/^https?:/, (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

test("production chat runs four real SDK responses and read tools without shopper mutations", async ({
  page,
}, testInfo) => {
  const before = business();
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Ask about the collection" })
    .fill("Find a towel alternative and check my budget.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".messages .assistant")).toContainText(
    "cotton bath towel",
  );
  await expect(page.locator(".messages .assistant")).toContainText(
    "bag and orders are unchanged",
  );
  expect(business()).toEqual(before);
  const data = receipts();
  expect(data).toHaveLength(1);
  expect(data[0].status).toBe("completed");
  expect(data[0].provider_observations).toHaveLength(4);
  expect(data[0].tools.map((item: { name: string }) => item.name)).toEqual([
    "searchProducts",
    "suggestAlternatives",
    "viewCart",
  ]);
  expect(data[0].reported_usage.fields.total_tokens).toBe(220);
  expect(data[0].provider_observations[0].body.unknown_field.preserved).toBe(
    true,
  );
  expect(JSON.stringify(data)).not.toContain("synthetic-not-a-provider-key");
  await page.screenshot({
    path: testInfo.outputPath("native-read-only-shopping-chat.png"),
    fullPage: true,
  });
});

test("provider and unfinished-item failures remain visible and a later native chat recovers", async ({
  page,
}) => {
  const before = business();
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Ask about the collection" });
  await input.fill("Simulate provider outage.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".messages .assistant").last()).toContainText(
    "could not complete",
  );
  await input.fill("Simulate an unfinished response.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect
    .poll(() => receipts().filter((item) => item.status === "failed").length)
    .toBe(2);
  expect(receipts().every((item) => item.tools.length === 0)).toBe(true);
  await input.fill("Find a complete towel alternative and check my budget.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".messages .assistant").last()).toContainText(
    "cotton bath towel",
  );
  expect(receipts().filter((item) => item.status === "completed")).toHaveLength(
    1,
  );
  expect(business()).toEqual(before);
});

test("a longer complete answer supports a later correction and follow-up", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Ask about the collection" });
  await input.fill("Give a long answer comparing towels and my budget.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.locator(".messages .assistant").last().innerText()).length,
    )
    .toBeGreaterThan(2000);
  await input.fill("Actually, check the current bag again before advising.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect
    .poll(() => receipts().filter((item) => item.status === "completed").length)
    .toBe(2);
  await expect(page.locator(".messages .assistant").last()).toContainText(
    "bag and orders are unchanged",
  );
});

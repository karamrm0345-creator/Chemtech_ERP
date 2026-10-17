import { test, expect, type Page } from "@playwright/test";

const PW = process.env.E2E_PASSWORD ?? "";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function pick(page: Page, trigger: string | RegExp, search: string) {
  await page.getByRole("button", { name: trigger }).first().click();
  await page.getByPlaceholder("Type to search…").fill(search);
  await page.locator("ul button").filter({ hasText: search }).first().click();
}

test.skip(!PW, "E2E_PASSWORD (demo password) is required");

test("sales order: officer prepares, manager approves, storekeeper delivers, stock decreases", async ({ page }) => {
  // Stock before
  await login(page, "gm@chemtech.demo");
  await page.goto("/inventory/items?q=DEMO-CON-001");
  const onHandBefore = Number((await page.locator("tbody tr").first().locator("td").nth(5).innerText()).replace(/,/g, ""));

  // 1. Sales officer creates and submits an order
  await login(page, "sales.officer@chemtech.demo");
  await page.goto("/sales/orders/new");
  await pick(page, /^Customer/, "Lusail Trading");
  await pick(page, "Item (optional)", "DEMO-CON-001");
  await page.locator("tbody tr").first().locator("input").nth(1).fill("2"); // quantity
  await page.getByRole("button", { name: /Save sales order/ }).click();
  await page.waitForURL(/\/sales\/orders\/c[a-z0-9]{20,}$/);
  const orderUrl = page.url();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
  // Officer cannot approve
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  // 2. Sales manager approves
  await login(page, "sales.manager@chemtech.demo");
  await page.goto(orderUrl);
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

  // 3. Storekeeper creates and posts the delivery
  await login(page, "storekeeper@chemtech.demo");
  await page.goto(orderUrl);
  await page.getByRole("link", { name: "Create delivery" }).click();
  await page.getByRole("button", { name: "Create draft delivery" }).click();
  await page.waitForURL(/\/sales\/deliveries\/c[a-z0-9]{20,}$/);
  await page.getByRole("button", { name: /Post delivery/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/Posted .* Stock issued/)).toBeVisible();

  // 4. Order fully delivered and stock reduced by exactly 2
  await page.goto(orderUrl);
  await expect(page.getByText("Delivered", { exact: true }).first()).toBeVisible();
  await login(page, "gm@chemtech.demo");
  await page.goto("/inventory/items?q=DEMO-CON-001");
  const onHandAfter = Number((await page.locator("tbody tr").first().locator("td").nth(5).innerText()).replace(/,/g, ""));
  expect(onHandAfter).toBe(onHandBefore - 2);
});

test("unauthenticated users are redirected to sign in; storekeeper cannot open admin pages", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await login(page, "storekeeper@chemtech.demo");
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/forbidden/);
});

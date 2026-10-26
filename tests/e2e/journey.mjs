// Browser acceptance journey (test 15) against a running server.
//   BASE_URL=http://localhost:3100 node tests/e2e/journey.mjs [screenshotDir]
// In DEMO mode it exercises the full UI with fixture data; against live it needs a signed-in
// storage state (E2E_STORAGE_STATE) for an owner account.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.argv[2] ?? null;
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, String(e.message).split("\n")[0]]);
  }
}

async function journey(browser, label, viewport, decisionQ) {
  const ctx = await browser.newContext({ viewport, storageState: process.env.E2E_STORAGE_STATE });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${label}-${n}.png`, fullPage: true });

  await step(`${label}: overview answers the four questions`, async () => {
    await page.goto(`${BASE}/`);
    for (const h of ["What needs Daniel", "What is blocked", "Evidence changes", "Last briefing"]) {
      assert.ok(await page.getByRole("heading", { name: h }).isVisible(), h);
    }
    if (process.env.EXPECT_DEMO === "1") assert.ok(await page.getByText("DEMO MODE").isVisible());
    await shot("overview");
  });

  await step(`${label}: no horizontal page scroll`, async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `overflow ${overflow}px`);
  });

  await step(`${label}: open a source from a claim (finding → claim → source)`, async () => {
    await page.goto(`${BASE}/evidence`);
    await page.getByRole("link", { name: /1023-EZ was submitted/ }).first().click();
    await page.waitForURL(/\/evidence\/claims\//);
    assert.ok(await page.getByText(/NOT an IRS determination/).isVisible());
    await page.getByRole("link", { name: /S05/ }).first().click();
    await page.waitForURL(/\/evidence\/sources\//);
    assert.ok(await page.getByText(/Unavailable in this project/).isVisible());
    await shot("source");
  });

  await step(`${label}: property keeps dated prices and unknown agreed price`, async () => {
    await page.goto(`${BASE}/property`);
    assert.ok(await page.getByText("Unknown — no agreement established").isVisible());
    assert.ok(await page.getByText("$1,050,000").first().isVisible());
    assert.ok(await page.getByText("below $800,000").first().isVisible());
  });

  await step(`${label}: funding shows cash vs remaining, unknown gap`, async () => {
    await page.goto(`${BASE}/funding`);
    const body = await page.textContent("main");
    if (process.env.EXPECT_DEMO === "1") {
      assert.match(body, /Cash received\$40,000/);
      assert.match(body, /Remaining binding commitments\$60,000/);
    }
    assert.match(body, /Gap to capital targetUnknown/);
  });

  await step(`${label}: edit a task`, async () => {
    await page.goto(`${BASE}/tasks`);
    const item = page.locator("li", { hasText: "Establish Daniel's exposure limits" }).first();
    await item.getByText("Edit", { exact: true }).click();
    await item.getByLabel("Next action").fill(`Schedule sponsor conversation (${label})`);
    await item.getByRole("button", { name: "Save task" }).click();
    await page.waitForURL(/msg=Task%20saved/);
    assert.ok(await page.getByText(`Schedule sponsor conversation (${label})`).isVisible());
    await shot("tasks");
  });

  await step(`${label}: run a brief and see the result`, async () => {
    await page.goto(`${BASE}/runs`);
    await page.getByRole("button", { name: "What needs my attention?" }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
    await page.waitForFunction(() => /completed|partial|failed/.test(document.querySelector("main")?.textContent ?? ""), null, { timeout: 20000 });
    await page.reload();
    assert.ok(await page.getByRole("heading", { name: "Recommended next actions (max 3)" }).isVisible());
    const n = await page.locator("section:has(h2:text('Recommended next actions')) ol > li").count();
    assert.ok(n <= 3, `actions ${n}`);
    await shot("run");
  });

  await step(`${label}: review a decision (defer with rationale)`, async () => {
    await page.goto(`${BASE}/decisions`);
    const card = page.locator("article", { hasText: decisionQ }).first();
    await card.getByText("Record a decision").click();
    await card.getByLabel("defer").check();
    await card.getByLabel("Rationale (required)").fill(`Waiting for funding qualification (${label})`);
    await card.getByRole("button", { name: "Record decision" }).click();
    await page.waitForURL(/msg=Decision%20recorded/);
    assert.ok(await page.getByText(`rationale: Waiting for funding qualification (${label})`).isVisible());
    await shot("decisions");
  });

  await step(`${label}: keyboard — skip link and visible focus`, async () => {
    await page.goto(`${BASE}/`);
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
    assert.equal(focused, "Skip to content");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.notEqual(outline, "none");
  });

  await step(`${label}: empty and error states render`, async () => {
    await page.goto(`${BASE}/tasks?error=Example%20error`);
    assert.ok(await page.getByRole("alert").filter({ hasText: "Example error" }).isVisible());
    await page.goto(`${BASE}/stakeholders`);
    assert.ok(await page.getByText("No drafts.").isVisible());
  });

  await step(`${label}: no client errors`, async () => assert.deepEqual(errors, []));
  await ctx.close();
}

const browser = await chromium.launch();
await journey(browser, "mobile390", { width: 390, height: 844 }, "Acquisition financing approach");
await journey(browser, "desktop", { width: 1366, height: 900 }, "Precise protected uses");
await browser.close();
for (const r of results) console.log(r.join(" | "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

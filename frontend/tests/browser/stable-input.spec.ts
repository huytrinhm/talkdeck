import { test, expect, type Page } from "@playwright/test";
import { installSpeechSafety } from "./safety";
test.beforeEach(async ({ page }) => {
  await installSpeechSafety(page);
});
async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
}
async function result(page: Page, text: string, final = false, old = false) {
  await page.evaluate(
    ({ text, final, old }) => {
      const r = (window as any).__safeRecognition;
      const callback = old ? (window as any).__oldResult : r.onresult;
      callback?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript: text }], { isFinal: final })],
      });
    },
    { text, final, old },
  );
}
test("explicit capture only, cancelled callbacks rejected after Resume, reload stays off and history is attributed", async ({
  page,
}) => {
  await create(page);
  await page
    .getByRole("button", { name: "Talk to generate", exact: true })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Pause (P)" })).toBeVisible();
  await result(page, "active input");
  await expect(page.locator(".speech-status")).toHaveText("active input");
  await page.evaluate(() => {
    (window as any).__oldResult = (window as any).__safeRecognition.onresult;
  });
  await page.getByRole("button", { name: "Pause (P)" }).click();
  await expect(page.locator(".speech-status")).toHaveCount(0);
  await result(page, "cancelled line", true, true);
  await expect(page.getByText("cancelled line")).toHaveCount(0);
  await page.getByRole("button", { name: "Resume (P)" }).click();
  await expect(page.getByRole("button", { name: "Pause (P)" })).toBeVisible();
  await result(page, "old callback after new session", true, true);
  await expect(page.getByText("old callback after new session")).toHaveCount(0);
  await result(page, "accepted narration", true);
  await expect(
    page
      .getByRole("list", { name: "Current session narration" })
      .getByText("accepted narration"),
  ).toBeVisible();
  await expect(page.locator(".speech-status")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume (P)" })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__safeRecognition === undefined),
  ).toBe(true);
  await expect(page.locator(".speech-status")).toHaveCount(0);
  await expect(
    page
      .getByRole("list", { name: "Saved transcript" })
      .getByText("accepted narration"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume (P)" }).click();
  await expect(page.getByRole("button", { name: "Pause (P)" })).toBeVisible();
  await result(page, "leave in progress");
  await page.evaluate(() => {
    (window as any).__oldResult = (window as any).__safeRecognition.onresult;
  });
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await result(page, "after route", true, true);
  await expect(page.getByText("after route")).toHaveCount(0);
  await expect(page.locator(".speech-status")).toHaveCount(0);
  const route = page.url().replace(/\/edit$/, "/create");
  await page.goto(route);
  await expect(page.getByRole("button", { name: "Resume (P)" })).toBeVisible();
  await expect(page.locator(".speech-status")).toHaveCount(0);
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/stable-transcript-saved-1512.png",
  });
});
test("Add selection focus/undo, no manual content UI, and stable stage gates at desktop and mobile", async ({
  page,
}) => {
  await create(page);
  const first = page.locator(".filmstrip-thumbnail");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  await expect(page.locator(".filmstrip-thumbnail").last()).toBeFocused();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".filmstrip-thumbnail")).toHaveCount(1);
  await expect(page.locator(".filmstrip-thumbnail")).toBeFocused();
  await page.getByLabel("Slide canvas", { exact: true }).dblclick();
  await expect(page.getByRole("dialog", { name: "Edit slide" })).toHaveCount(0);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator(".practice-coach")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.locator(".practice-coach")).toHaveCount(0);
  const blackout = page.getByRole("button", {
    name: "Black out audience screen (B)",
  });
  await expect(blackout).toHaveText("");
  await blackout.click();
  await expect(
    page.getByRole("button", { name: "Restore audience screen (B)" }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const width of [1512, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/stable-present-${width}.png`,
    });
  }
});
test("speech route reload requires a fresh microphone action", async ({
  page,
}) => {
  await create(page);
  await page
    .getByRole("button", { name: "Talk to generate", exact: true })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Pause (P)" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume (P)" })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__safeRecognition === undefined),
  ).toBe(true);
  await expect(page.locator(".speech-status")).toHaveCount(0);
});

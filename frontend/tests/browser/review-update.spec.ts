import { test, expect, type Page } from "@playwright/test";
import { installSpeechSafety } from "./safety";
test.beforeEach(async ({ page }) => installSpeechSafety(page));
async function project(page: Page) {
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
test("drawing cursors match tools, manual themes are absent and narrow controls stay contained", async ({
  page,
}) => {
  await project(page);
  await expect(
    page.getByRole("toolbar", { name: "Drawing tools" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Draw", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Pen (hold D)" }).click();
  await page.getByRole("button", { name: "Pointer (Esc)" }).click();
  await expect(
    page.getByRole("button", { name: "Pointer (Esc)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Slide theme" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(Paper|Midnight|Lavender) theme$/ }),
  ).toHaveCount(0);
  const canvas = page.getByLabel("Slide annotations");
  for (const [label, tool] of [
    ["Pen (hold D)", "pen"],
    ["Highlighter (hold H)", "highlighter"],
    ["Erase whole stroke (hold E)", "eraser"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(canvas).toHaveAttribute("data-canvas-tool", tool);
    expect(
      await canvas.evaluate((el) => getComputedStyle(el).cursor),
    ).toContain("data:image/svg+xml");
  }
  await page.keyboard.down("h");
  await expect(canvas).toHaveAttribute("data-canvas-tool", "highlighter");
  await page.keyboard.up("h");
  await expect(canvas).toHaveAttribute("data-canvas-tool", "pointer");
  await page.keyboard.down("e");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(canvas).toHaveAttribute("data-canvas-tool", "pointer");
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/review-canvas-tools-1512.png",
  });
  for (const width of [786, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    if (width === 390) {
      expect(
        (await page.locator(".header-actions").boundingBox())!.height,
      ).toBeLessThanOrEqual(40);
      expect(
        await page
          .locator(".transcript-empty .idle")
          .evaluate((el) => getComputedStyle(el).textAlign),
      ).toBe("left");
    }
    const tools = await page
        .getByRole("toolbar", { name: "Drawing tools" })
        .boundingBox(),
      stage = await page.locator(".stage").boundingBox();
    expect(tools!.x).toBeGreaterThanOrEqual(stage!.x);
    expect(tools!.x + tools!.width).toBeLessThanOrEqual(
      stage!.x + stage!.width + 1,
    );
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/review-canvas-tools-${width}.png`,
    });
  }
});
test("presenter transcript has timed narration, blackout is named, audience fullscreen hides entry control until exit", async ({
  page,
}) => {
  await project(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.locator(".transcript-presenter")).toBeVisible();
  await page.waitForFunction(
    () => typeof (window as any).__safeRecognition?.onresult === "function",
  );
  await page.evaluate(() => {
    const result: any = [{ transcript: "A clear statement for the audience." }];
    result.isFinal = true;
    (window as any).__safeRecognition.onresult({
      resultIndex: 0,
      results: [result],
    });
  });
  await expect(
    page.getByRole("list", { name: "Current session narration" }),
  ).toContainText("A clear statement for the audience.");
  await expect(page.getByText(/^Narration · This device$/)).toBeVisible();
  await page
    .getByRole("button", { name: "Black out audience screen (B)" })
    .click();
  await expect(
    page.getByRole("button", { name: "Restore audience screen (B)" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("talkdeck-audience-output")!).black,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Restore audience screen (B)" })
    .click();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/review-presenter-transcript.png",
  });
  await page.getByRole("button", { name: "Audience (A)" }).click();
  await page
    .getByRole("main", { name: "Audience display" })
    .getByRole("button", { name: "Fullscreen (F)", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await expect(
    page
      .getByRole("main", { name: "Audience display" })
      .getByRole("button", { name: "Fullscreen (F)" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/review-audience-fullscreen.png",
  });
  await page.evaluate(() => document.exitFullscreen());
  await expect(
    page.getByRole("main", { name: "Audience display" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("main", { name: "Audience display" })
      .getByRole("button", { name: "Fullscreen (F)", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return", exact: true }).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
});

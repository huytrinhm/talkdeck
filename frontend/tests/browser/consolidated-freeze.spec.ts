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
async function speak(page: Page, text: string, final = false, index = 0) {
  await expect(page.getByRole("button", { name: "Pause (P)" })).toBeVisible();
  await page.evaluate(
    ({ text, final, index }) => {
      const r = (window as any).__safeRecognition;
      const rows = Array.from({ length: index + 1 }, () =>
        Object.assign([{ transcript: "" }], { isFinal: true }),
      );
      rows[index] = Object.assign([{ transcript: text }], { isFinal: final });
      r.onresult({ resultIndex: index, results: rows });
    },
    { text, final, index },
  );
}
test("last live transcript row has no orphan caret line and finalization preserves a single phrase", async ({
  page,
}) => {
  await create(page);
  await page
    .getByRole("button", { name: "Talk to generate", exact: true })
    .first()
    .click();
  const phrase =
    "A current utterance with enough words to wrap safely inside the transcript panel.";
  await speak(page, phrase);
  const row = page.locator(".workspace-sidebar .interim");
  await expect(row).toBeVisible();
  await page.screenshot({ path: "test-results/last-transcript-before.png" });
  const layout = await row.evaluate((el) => ({
    after: getComputedStyle(el, "::after").content,
    paragraphBottom: el.querySelector("p")!.getBoundingClientRect().bottom,
    rowBottom: el.getBoundingClientRect().bottom,
    lineHeight: getComputedStyle(el).lineHeight,
  }));
  console.log("last row geometry", layout);
  expect(layout.after).not.toContain("▏");
  await speak(page, phrase, true);
  await expect(page.locator(".interim")).toHaveCount(0);
  await expect(
    page
      .locator(".workspace-sidebar .transcript")
      .getByText(phrase, { exact: true }),
  ).toHaveCount(1);
});
test("final transcript row has no trailing divider while earlier rows retain separators", async ({
  page,
}) => {
  await create(page);
  await page
    .getByRole("button", { name: "Talk to generate", exact: true })
    .first()
    .click();
  await speak(page, "First captured phrase.", true);
  await speak(page, "Last captured phrase.", true, 1);
  const rows = page.locator(".workspace-sidebar .transcript-phrase");
  await expect(rows).toHaveCount(2);
  expect(
    await rows.first().evaluate((el) => getComputedStyle(el).borderBottomWidth),
  ).toBe("1px");
  expect(
    await rows.last().evaluate((el) => getComputedStyle(el).borderBottomWidth),
  ).toBe("0px");
});
test("first freeze hides all companion/Phone/BYOK settings and sender routes without bootstrapping services", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/connections")) calls.push(r.url());
  });
  await page.goto("/#phone?pair=discarded-test-code");
  await expect(page).toHaveURL(/#projects$/);
  await expect(
    page.getByRole("heading", { name: "Use this phone as your microphone" }),
  ).toHaveCount(0);
  await create(page);
  await expect(
    page.getByRole("button", { name: "App settings", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Reduce motion")).toHaveCount(0);

  await expect(
    page.getByText(
      /Connections|Practice coach|Your API key|Voice devices|Show practice companion/,
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: /Coach|Connections/ }),
  ).toHaveCount(0);
  expect(calls).toEqual([]);
});
test("Practice completion returns to current project and selected slide; Overview has no Done", async ({
  page,
}) => {
  await create(page);
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  const selected = await page
    .locator(".filmstrip-thumbnail[aria-current=true]")
    .getAttribute("data-id");
  const edit = page.url();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Slide changes/ }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review complete" }),
  ).toBeVisible();
  const back = page.getByRole("button", { name: "Back to slide", exact: true });
  await expect(back.locator("svg.lucide-arrow-left")).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(edit);
  await expect(page.getByLabel("Slide canvas", { exact: true })).toBeVisible();
  await expect(
    page.locator(".filmstrip-thumbnail[aria-current=true]"),
  ).toHaveAttribute("data-id", selected!);
});
test("horizontal swatches and three visual size choices align next to the tool and clamp on mobile", async ({
  page,
}) => {
  await create(page);
  for (const width of [1512, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .getByRole("button", { name: "pen color and thickness", exact: true })
      .click();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    const options = page.locator("[data-annotation-options]");
    await expect(options).toBeVisible();
    await expect(options.locator(".ink-colors button")).toHaveCount(6);
    await expect(options.locator(".ink-sizes button")).toHaveCount(3);
    const corner = await page
      .getByRole("button", { name: "pen color and thickness", exact: true })
      .boundingBox();
    const tool = await page
      .getByRole("button", { name: "Pen (hold D)", exact: true })
      .boundingBox();
    expect(corner!.x).toBeGreaterThan(tool!.x + tool!.width / 2);
    expect(corner!.y).toBeGreaterThan(tool!.y + tool!.height / 2);
    await expect
      .poll(async () => (await options.boundingBox())!.x)
      .toBeGreaterThan(tool!.x);
    const box = await options.boundingBox();
    expect(box!.x).toBeGreaterThan(tool!.x);
    expect(
      Math.abs(box!.y + box!.height / 2 - (tool!.y + tool!.height / 2)),
    ).toBeLessThan(12);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width - 4);
    const swatches = await options
      .locator(".ink-colors button")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().y));
    expect(Math.max(...swatches) - Math.min(...swatches)).toBeLessThan(1);
    await page.getByRole("button", { name: "Blue ink", exact: true }).click();
    await page
      .getByRole("button", { name: "5 px thickness", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "5 px thickness", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/first-freeze-horizontal-picker-${width}.png`,
    });
    await page.keyboard.press("Escape");
    if (width === 320) {
      const grip = page.getByRole("button", { name: "Move drawing tools" });
      await grip.focus();
      for (let i = 0; i < 28; i++) await grip.press("ArrowRight");
      await page
        .getByRole("button", { name: "pen color and thickness", exact: true })
        .click();
      const popup = page.locator(".ink-options-popover");
      await expect
        .poll(async () => {
          const b = await popup.boundingBox();
          return b!.x + b!.width;
        })
        .toBeLessThanOrEqual(316);
      const edge = await popup.boundingBox();
      expect(edge!.x).toBeGreaterThanOrEqual(4);
      expect(edge!.x + edge!.width).toBeLessThanOrEqual(316);
      await page.screenshot({
        path: "docs/main-ui-report/capture-assets/first-freeze-horizontal-picker-edge-320.png",
      });
      await page.keyboard.press("Escape");
    }
  }
});
test("shared last-row rendering holds in Practice, Present and saved Review at narrow width", async ({
  page,
}) => {
  await create(page);
  await page.setViewportSize({ width: 390, height: 900 });
  const check = async (selector: string) => {
    const region = page.locator(selector),
      rows = region.locator(".transcript-phrase");
    await expect(rows.last()).toBeVisible();
    await rows.last().scrollIntoViewIfNeeded();
    expect(
      await rows
        .last()
        .evaluate((el) => getComputedStyle(el).borderBottomWidth),
    ).toBe("0px");
    expect(
      await rows
        .last()
        .evaluate((el) => getComputedStyle(el, "::after").content),
    ).not.toContain("▏");
    const times = region.locator(".phrase-meta time");
    if (await times.count()) {
      const box = await region.boundingBox(),
        last = await times.last().boundingBox();
      expect(last!.x + last!.width).toBeLessThanOrEqual(
        box!.x + box!.width + 1,
      );
    }
    expect(await region.locator("[data-last-phrase]").count()).toBe(1);
  };
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await speak(page, "First practice narration.", true);
  await speak(
    page,
    "Last practice narration wraps through the transcript region without a trailing line.",
    false,
    1,
  );
  await check(".presenter-transcript > .transcript");
  await speak(
    page,
    "Last practice narration wraps through the transcript region without a trailing line.",
    true,
    1,
  );
  await expect(page.locator(".interim")).toHaveCount(0);
  await check(".presenter-transcript > .transcript");
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  await page.getByRole("tab", { name: /Slide changes/ }).click();
  await check(".review-transcript .transcript");
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await speak(page, "A presentation phrase.", true);
  await speak(
    page,
    "A current presentation phrase only in transcript.",
    false,
    1,
  );
  await check(".presenter-transcript > .transcript");
  await expect(page.locator(".present-stage")).not.toContainText(
    "A current presentation phrase only in transcript.",
  );
  await speak(
    page,
    "A current presentation phrase only in transcript.",
    true,
    1,
  );
  await expect(page.locator(".interim")).toHaveCount(0);
  await check(".presenter-transcript > .transcript");
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/first-freeze-last-row-present-390.png",
  });
});

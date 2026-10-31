import { test, expect, type Page } from "@playwright/test";
import { installSpeechSafety } from "./safety";
async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Slide instructions", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
}
async function final(page: Page, text: string) {
  await expect(
    page.getByRole("button", { name: "Pause (P)", exact: true }),
  ).toBeVisible();
  await page.evaluate((text) => {
    (window as any).__safeRecognition.onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: true })],
    });
  }, text);
}
async function finishPractice(page: Page) {
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Slide changes/ }).click();
  while (
    await page.getByRole("button", { name: "Reject", exact: true }).isVisible()
  ) {
    await page.getByRole("button", { name: "Reject", exact: true }).click();
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "Back to slide", exact: true })
      .locator("svg.lucide-arrow-left"),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/local-fix-completion.png",
  });
  await page
    .getByRole("button", { name: "Back to slide", exact: true })
    .click();
}
test("each explicit Practice/Present starts fresh while earlier words stay in saved history", async ({
  page,
}) => {
  await installSpeechSafety(page);
  await create(page);
  await page
    .getByRole("button", { name: "Talk to generate", exact: true })
    .first()
    .click();
  await final(page, "Original saved narration.");
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  for (const mode of ["Practice", "Present", "Practice", "Present"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    const current = page.locator(".presenter-transcript > .transcript");
    await expect(
      current.getByText("Ready when you are", { exact: true }),
    ).toBeVisible();
    await expect(current.locator(".transcript-phrase")).toHaveCount(0);
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/local-fix-${mode.toLowerCase()}-fresh.png`,
    });
    await expect(
      page.getByText("Saved transcript", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Pause (P)", exact: true }),
    ).toBeVisible();
    await final(page, `New ${mode} narration.`);
    await expect(
      current.getByText(`New ${mode} narration.`, { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/local-fix-${mode.toLowerCase()}.png`,
    });
    if (mode === "Practice") await finishPractice(page);
    else await page.getByRole("button", { name: "End", exact: true }).click();
  }
  await expect(
    page
      .locator(".workspace-sidebar .transcript")
      .getByText("Original saved narration.", { exact: true }),
  ).toBeVisible();
});
test("System prompt lives only in Context and survives settings and mode changes", async ({
  page,
}) => {
  await installSpeechSafety(page);
  await create(page);
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  const prompt = page.getByLabel("System prompt", { exact: true });
  const original = await prompt.inputValue();
  await prompt.fill(`${original}\nKeep this instruction.`);
  for (const name of ["App settings", "Project settings", "Toggle sidebar"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  }
  await expect(prompt).toHaveValue(`${original}\nKeep this instruction.`);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await finishPractice(page);
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await expect(prompt).toHaveValue(`${original}\nKeep this instruction.`);
  await page.setViewportSize({ width: 390, height: 853 });
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/local-fix-context-390.png",
  });
});
test("waveform follows synthetic signal levels and goes flat on silence, mute, pause and end", async ({
  page,
}) => {
  await installSpeechSafety(page, true);
  await create(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__syntheticGain))
    .toBe(true);
  const level = () =>
    page
      .locator(".waveform span")
      .evaluateAll((els) =>
        Math.max(
          ...els.map((el) => parseFloat((el as HTMLElement).style.height)),
        ),
      );
  const amplitude = async (value: number) =>
    page.evaluate((value) => {
      (window as any).__syntheticGain.gain.value = value;
    }, value);
  await amplitude(0);
  await expect.poll(level).toBeLessThan(3.2);
  await amplitude(0.01);
  await expect.poll(level).toBeGreaterThan(10);
  const quiet = await level();
  await amplitude(0.1);
  await expect.poll(level).toBeGreaterThan(quiet + 6);
  await expect.poll(level).toBeLessThanOrEqual(30);
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/local-fix-waveform-voice.png",
  });
  await page.getByRole("button", { name: "Mute (M)", exact: true }).click();
  await expect.poll(level).toBe(3);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__rawMediaStream
          .getTracks()
          .every((t: MediaStreamTrack) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Unmute (M)", exact: true }).click();
  await expect.poll(level).toBeGreaterThan(10);
  await page.getByRole("button", { name: "Pause (P)", exact: true }).click();
  await expect.poll(level).toBe(3);
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/local-fix-waveform-paused.png",
  });
  await page.getByRole("button", { name: "End", exact: true }).click();
  await expect(page.locator(".waveform")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__rawMediaStream
          .getTracks()
          .every((t: MediaStreamTrack) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
});

test("root keeps only a padded centered projects panel and create/open works across desktop and mobile", async ({
  page,
}) => {
  await installSpeechSafety(page);
  await page.goto("/");
  for (const width of [1920, 1512, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "All projects", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".dashboard aside, .dashboard header"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Search projects", exact: true }),
    ).toHaveCount(0);
    const panel = await page.locator(".dashboard-main").boundingBox();
    expect(panel!.width).toBe(Math.min(1200, width));
    expect(Math.abs(panel!.x - (width - panel!.width) / 2)).toBeLessThan(1);
    const geometry = await page
      .locator(".dashboard-content")
      .evaluate((el) => ({
        left: parseFloat(getComputedStyle(el).paddingLeft),
        right: parseFloat(getComputedStyle(el).paddingRight),
        top: parseFloat(getComputedStyle(el).paddingTop),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
    expect(geometry.left).toBeGreaterThanOrEqual(20);
    expect(geometry.right).toBe(geometry.left);
    expect(geometry.top).toBeGreaterThanOrEqual(24);
    expect(geometry.overflow).toBe(false);
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/local-fix-root-empty-${width}.png`,
    });
  }
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Root layout check");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start with an idea", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to projects", exact: true })
    .click();
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("button", { name: "Open Root layout check", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/local-fix-root-projects-${width}.png`,
    });
  }
  await page
    .getByRole("button", { name: "Open Root layout check", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Root layout check", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add slide", exact: true }),
  ).toBeVisible();
});

test("voice modes listen on entry and reload, with a dark audience control", async ({
  page,
}) => {
  await installSpeechSafety(page);
  await create(page);
  for (const mode of ["create", "practice", "present"]) {
    await page.evaluate((mode) => {
      location.hash = location.hash.replace(/\/[^/]+$/, `/${mode}`);
    }, mode);
    await expect(
      page.getByRole("button", { name: "Pause (P)", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Pause (P)", exact: true }),
    ).toBeVisible();
    if (mode === "create") {
      await expect(page.locator(".voice-target")).toHaveAttribute(
        "data-variant",
        "secondary",
      );
    }
    await page.getByRole("button", { name: "Pause (P)", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Resume (P)", exact: true }),
    ).toBeVisible();
  }
});

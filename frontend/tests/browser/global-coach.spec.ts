import { test, expect, type Page } from "@playwright/test";
test.skip(true, "Deferred: Phone, BYOK and companion UI/routes are intentionally unmounted for first freeze. Pure service tests remain active.");
import { installSpeechSafety, configurePhoneFixture } from "./safety";
test.beforeEach(async ({ page }) => {
  await installSpeechSafety(page);
});
test("@adapter-fixture selecting another device in App settings never restarts capture", async ({
  page,
}) => {
  await create(page);
  await configurePhoneFixture(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause (P)" })).toBeVisible();
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await page.evaluate(async () => {
    const f = (window as any).__phoneFixture;
    await f.controller.join("fixture");
    f.emit({ status: "connected" });
    f.controller.selectSource("phone");
  });
  await page.getByRole("button", { name: "This device", exact: true }).click();
  await page
    .getByRole("button", { name: "Back to presentation", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Resume (P)" })).toBeVisible();
  await page.getByRole("button", { name: "Resume (P)" }).click();
  await expect(page.getByRole("button", { name: "Pause (P)" })).toBeVisible();
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
test("global connections works without a project, keeps secrets out of project settings and returns focus", async ({
  page,
}) => {
  await page.goto("/");
  const button = page.getByRole("button", {
    name: "App settings",
    exact: true,
  });
  await button.click();
  await expect(
    page.getByText("Your connections apply across your projects."),
  ).toBeVisible();
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveCount(
    0,
  );
  for (const width of [1512, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/global-connections-${width}.png`,
    });
  }
  await page.getByRole("tab", { name: "Coach", exact: true }).click();
  await expect(page.getByText("Live coach is not connected.")).toBeVisible();
  await page.getByRole("tab", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Show practice companion").uncheck();
  await page
    .getByRole("button", { name: "Back to projects", exact: true })
    .click();
  await expect(button).toBeFocused();
  await page.setViewportSize({ width: 1512, height: 900 });
  await create(page);
  await page
    .getByRole("button", { name: "Project settings", exact: true })
    .click();
  await expect(page.getByLabel("Slide instructions")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Voice devices" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
});
test("Practice and Present hide unavailable coach and keep explicit capture controls", async ({
  page,
}) => {
  await create(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause (P)" })).toBeVisible();
  await expect(page.locator(".practice-coach")).toHaveCount(0);
  await expect(page.getByText("Live coach is not connected.")).toHaveCount(0);
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await page.getByRole("button", { name: "Back to presentation" }).click();
  await expect(page.getByRole("button", { name: "Resume (P)" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/stable-practice-390.png",
  });
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.locator(".practice-coach")).toHaveCount(0);
  const blackout = page.getByRole("button", {
    name: "Black out audience screen (B)",
  });
  await expect(blackout).toHaveText("");
  await expect(blackout).toHaveAttribute(
    "title",
    "Black out audience screen (B)",
  );
  await blackout.click();
  await expect(
    page.getByRole("button", { name: "Restore audience screen (B)" }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("@adapter-fixture coach consent, input mute, output mute/interrupt, feedback, route cleanup and stale events", async ({
  page,
}) => {
  await create(page);
  await page.evaluate(async () => {
    const url =
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => n.includes("/src/services/practiceCoach.ts"))
        .at(-1) ?? "/src/services/practiceCoach.ts";
    const { configureCoachPort } = await import(/* @vite-ignore */ url);
    let emit = (e: any) => {
      void e;
    };
    const calls: string[] = [];
    configureCoachPort({
      available: true,
      inputMode: "audio",
      voiceOutput: true,
      open: async (_request: any, fn: any) => {
        calls.push("open");
        emit = fn;
        return {
          ask: async () => {
            calls.push("ask");
            emit({ type: "task", state: "running" });
          },
          startInput: async () => {
            calls.push("startInput");
            emit({ type: "input", state: "listening" });
          },
          stopInput: () => calls.push("stopInput"),
          setInputMuted: (v: boolean) => calls.push(`inputMuted:${v}`),
          setOutputMuted: (v: boolean) => calls.push(`outputMuted:${v}`),
          stopSpeaking: () => calls.push("stopSpeaking"),
          close: () => calls.push("close"),
        };
      },
    });
    (window as any).__coach = { emit: (e: any) => emit(e), calls };
  });
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.getByText("Coach is quiet while you speak.")).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/coach-ready-fixture-1512.png",
  });
  await page
    .getByRole("button", { name: "Pause & ask coach", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Resume (P)" })).toBeVisible();
  await page
    .getByLabel("Question for coach", { exact: true })
    .fill("How can I clarify this?");
  await expect(
    page.getByRole("button", { name: "Send question" }),
  ).toBeDisabled();
  await page.getByLabel(/Share my question/).check();
  await page.getByLabel("Play this reply aloud").check();
  await page.getByRole("button", { name: "Send question" }).click();
  expect(
    await page.evaluate(() =>
      (window as any).__coach.calls.includes("startInput"),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    const c = (window as any).__coach;
    c.emit({
      type: "reply",
      text: "Service fixture reply: try one concrete example.",
    });
    c.emit({ type: "playback", state: "speaking" });
  });
  await expect(
    page.getByRole("button", { name: "Stop speaking" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/coach-speaking-fixture-1512.png",
  });
  await page.getByRole("button", { name: "Stop speaking" }).click();
  await expect(
    page.getByText("Coach task running", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start coach microphone" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as any).__coach.emit({ type: "task", state: "complete" }),
  );
  await page.getByRole("button", { name: "Start coach microphone" }).click();
  await page.evaluate(() =>
    (window as any).__coach.emit({ type: "task", state: "running" }),
  );
  await expect(
    page.getByRole("button", { name: "Mute coach input" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Turn coach voice off" }).click();
  await expect(
    page.getByText("Coach input listening · Coach voice off", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mute coach input" }).click();
  await expect(
    page.getByRole("button", { name: "Unmute coach input" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).__coach.emit({
      type: "feedback",
      item: {
        id: "fixture-note",
        text: "A service-provided note for this slide.",
        slideId: "fixture-slide",
        interval: { start: 0, end: 2 },
      },
    }),
  );
  await page.getByRole("button", { name: "Finish practice" }).click();
  await expect(
    page.getByText("A service-provided note for this slide."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Feedback incomplete when practice ended. The service task may still be running.",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/coach-review-fixture-1512.png",
  });
  expect(
    await page.evaluate(
      () =>
        (window as any).__coach.calls.filter((x: string) => x === "close")
          .length,
    ),
  ).toBe(1);
  await page.evaluate(() =>
    (window as any).__coach.emit({ type: "reply", text: "Late invalid reply" }),
  );
  await expect(page.getByText("Late invalid reply")).toHaveCount(0);
});

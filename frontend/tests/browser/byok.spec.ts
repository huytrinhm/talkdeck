import { test, expect, type Page } from "@playwright/test";
test.skip(true, "Deferred: Phone, BYOK and companion UI/routes are intentionally unmounted for first freeze. Pure service tests remain active.");
import { installSpeechSafety } from "./safety";
test.use({ trace: "off" });
test.beforeEach(async ({ page }) => installSpeechSafety(page));
async function settings(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByRole("button", { name: "App settings", exact: true }).click();
}
test("personal API key entry is disabled until secure service capability exists", async ({
  page,
}) => {
  await settings(page);
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Save & verify", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Personal API keys are not supported on this server yet."),
  ).toBeVisible();
  await page.getByText("About your key", { exact: true }).click();
  await expect(page.getByText(/No ChatGPT sign-in is required/)).toBeVisible();
  await page
    .locator(".api-key-settings")
    .screenshot({
      path: "docs/main-ui-report/capture-assets/byok-unavailable.png",
    });
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) => /api.?key/i.test(key)),
    ),
  ).toBe(false);
});
test("@adapter-fixture personal key lifecycle waits for acknowledgements and screenshots contain no draft", async ({
  page,
}) => {
  await settings(page);
  await page.evaluate(async () => {
    const url =
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((name) => name.includes("/src/services/personalApiKey.ts")) ??
      "/src/services/personalApiKey.ts";
    const { personalApiKey, ApiKeyFailure } = await import(
      /* @vite-ignore */ url
    );
    let configured = false;
    let resolve: ((value: { configured: true }) => void) | undefined;
    const fixture = {
      fail: true,
      confirm: () => {
        configured = true;
        resolve?.({ configured: true });
      },
    };
    await personalApiKey.configure({
      available: true,
      verifiesKey: true,
      getStatus: async () => ({ configured }),
      save: async () => {
        if (fixture.fail) throw new ApiKeyFailure("invalid-key");
        return new Promise((r) => {
          resolve = r;
        });
      },
      remove: async () => {
        configured = false;
        return { configured: false };
      },
    });
    (window as any).__keyServiceFixture = fixture;
  });
  const input = page.getByLabel("OpenAI API key", { exact: true });
  await input.fill("fixture-value-not-a-real-credential");
  await expect(input).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show API key" }).click();
  await expect(input).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide API key" }).click();
  await page
    .getByRole("button", { name: "Save & verify", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await expect(
    page.getByText("The key could not be verified. Re-enter it and try again."),
  ).toBeVisible();
  await page
    .locator(".api-key-settings")
    .screenshot({
      path: "docs/main-ui-report/capture-assets/byok-error-fixture.png",
    });
  await page.getByRole("button", { name: "Check key status" }).click();
  await page.evaluate(() => ((window as any).__keyServiceFixture.fail = false));
  await input.fill("fixture-value-not-a-real-credential");
  await page
    .getByRole("button", { name: "Save & verify", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("button", { name: "Verifying…" })).toBeDisabled();
  await page
    .locator(".api-key-settings")
    .screenshot({
      path: "docs/main-ui-report/capture-assets/byok-validating-fixture.png",
    });
  await page.evaluate(() => (window as any).__keyServiceFixture.confirm());
  await expect(page.getByText("API key configured.")).toBeVisible();
  await page
    .locator(".api-key-settings")
    .screenshot({
      path: "docs/main-ui-report/capture-assets/byok-configured-fixture.png",
    });
  await page.getByRole("button", { name: "Replace key", exact: true }).click();
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "Cancel replacement" }).click();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await expect(page.getByText("API key configured.")).toHaveCount(0);
  await expect(input).toHaveValue("");
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) => /api.?key/i.test(key)),
    ),
  ).toBe(false);
});

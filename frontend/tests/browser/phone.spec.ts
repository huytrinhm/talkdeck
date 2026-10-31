import { test, expect } from "@playwright/test";
import { installSpeechSafety, configurePhoneFixture } from "./safety";
test.beforeEach(async ({ page }) => {
  await installSpeechSafety(page, true);
});
async function create(page: any) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Phone interaction check");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start with an idea" }),
  ).toBeVisible();
}
test("sidebar starts open on desktop/mobile and first-freeze preferences hide experimental services", async ({
  page,
}) => {
  await create(page);
  for (const width of [1512, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("complementary", { name: "Project sidebar" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(
      page.getByRole("complementary", { name: "Project sidebar" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(
      page.getByRole("complementary", { name: "Project sidebar" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Preferences" }),
  ).toBeVisible();
  await expect(page.getByText("Connections", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Phone", exact: true }),
  ).toHaveCount(0);
});
test.skip("@adapter-fixture mocked receiver pairs, explicitly selects phone, mutes, disconnects and never starts fallback microphone", async ({
  page,
}) => {
  await create(page);
  await configurePhoneFixture(page);
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await page.getByRole("button", { name: "Connect phone" }).click();
  await expect(
    page.getByRole("img", { name: "Phone pairing QR code" }),
  ).toBeVisible();
  await page.getByText("Use a pairing code instead", { exact: true }).click();
  await expect(page.getByLabel("Pairing code")).toHaveValue("TEST-ONLY-CODE");
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/phone-pairing-fixture.png",
  });
  await page.evaluate(() =>
    (window as any).__phoneFixture.emit({
      status: "connected",
      deviceName: "Test phone",
    }),
  );
  await expect(page.getByLabel("Pairing code")).toHaveCount(0);
  await page.getByRole("button", { name: "Phone", exact: true }).click();
  await page.getByRole("button", { name: "Mute phone" }).click();
  await expect(
    page.getByRole("button", { name: "Unmute phone" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unmute phone" }).click();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/phone-connected-fixture.png",
  });
  await page
    .getByRole("button", { name: "Back to presentation", exact: true })
    .click();
  await page.getByRole("button", { name: "Talk to generate" }).first().click();
  await expect(
    page.getByText("Start the microphone on your phone."),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).__phoneFixture.emit({
      status: "connected",
      capturing: true,
    }),
  );
  await page.evaluate(() =>
    (window as any).__phoneFixture.emit({
      speech: { text: "A real test utterance", final: true },
    }),
  );
  await expect(page.locator(".transcript")).toContainText(
    "A real test utterance",
  );
  await page.evaluate(() =>
    (window as any).__phoneFixture.emit({ status: "disconnected" }),
  );
  await expect(
    page.getByText(
      "Phone disconnected. Reconnect in Settings or select This device.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__safeRecognition),
  ).toBeUndefined();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/phone-disconnected-fixture.png",
  });
  await page.getByRole("button", { name: "Finish", exact: true }).click();
});
test.skip("@adapter-fixture phone sender is safe when unavailable and mocked permission is requested only after Start", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#phone");
  await expect(
    page.getByRole("button", { name: "Start microphone" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => (window as any).__safeRecognition),
  ).toBeUndefined();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/phone-sender-unavailable-390.png",
  });
  await configurePhoneFixture(page, "raw-audio");
  await page.getByLabel("Pairing code").fill("TEST-ONLY-CODE");
  await page.getByRole("button", { name: "Connect to presentation" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Connecting…" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).__phoneFixture.emit({
      status: "connected",
      deviceName: "Test presentation",
    }),
  );
  expect(
    await page.evaluate(() => (window as any).__safeRecognition),
  ).toBeUndefined();
  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(page.getByText("Microphone on", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/phone-sender-active-mock-390.png",
  });
  await page
    .getByRole("button", { name: "Mute microphone", exact: true })
    .click();
  await expect(
    page.getByText("Microphone muted", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Unmute microphone", exact: true })
    .click();
  await page.evaluate(() => ((window as any).__denyRawMedia = true));
  await page.getByRole("button", { name: "Stop microphone" }).click();
  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(page.getByText("Permission: Blocked")).toBeVisible();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/phone-sender-denied-mock-390.png",
  });
  await page.evaluate(() => ((window as any).__denyRawMedia = false));
  await page.getByRole("button", { name: "Start microphone" }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByText("Microphone off", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start microphone" }),
  ).toBeDisabled();
});

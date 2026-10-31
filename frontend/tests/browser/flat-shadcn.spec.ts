import { test, expect } from "@playwright/test";
import { installSpeechSafety } from "./safety";
import { fixture } from "./fixture";
test("flat projects, stock shadcn controls and main interaction surfaces work on desktop and mobile", async ({
  page,
}) => {
  await installSpeechSafety(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "All projects", exact: true }),
  ).toBeVisible();
  const color = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  });
  expect(color[0]).toBe(color[1]);
  expect(color[1]).toBe(color[2]);
  expect(color[0]).toBeLessThan(30);
  expect(color[3]).toBe(255);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page).toHaveURL(/#new$/);
  await expect(page.getByRole("button", { name: /Browse/ })).toHaveCount(0);
  await expect(page.locator("fieldset").getByRole("textbox")).toHaveCount(2);
  const title = page.getByLabel("Title", { exact: true });
  await expect(title).toHaveClass(/border-input/);
  await title.fill("Flat project");
  await page
    .getByLabel(/Description/)
    .fill("Project data stays with the presentation.");
  for (const width of [1512, 832, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page
        .locator(".setup-header")
        .getByRole("button", { name: "Create project", exact: true }),
    ).toHaveCount(0);
    const finish = await page
      .getByRole("button", { name: "Create project", exact: true })
      .boundingBox();
    const details = await page.locator(".setup-details").boundingBox();
    const materials = await page.locator(".setup-materials").boundingBox();
    expect(finish!.y).toBeGreaterThan(
      Math.max(details!.y + details!.height, materials!.y + materials!.height) +
        24,
    );
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/create-project-bottom-${width}.png`,
    });
  }
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await expect(page.getByLabel("System prompt", { exact: true })).toBeVisible();
  for (const width of [1512, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/flat-shadcn-workspace-${width}.png`,
    });
  }
  for (const name of ["App settings", "Project settings", "Toggle sidebar"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  }
  await expect(
    page.getByRole("complementary", { name: "Project sidebar" }),
  ).toBeVisible();
  await expect(page.locator(".filmstrip")).toHaveCSS(
    "border-top-style",
    "solid",
  );
  await page.setViewportSize({ width: 1512, height: 900 });
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.screenshot({
    path: "docs/main-ui-report/capture-assets/flat-shadcn-practice.png",
  });
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  for (const width of [1512, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/main-ui-report/capture-assets/flat-shadcn-review-${width}.png`,
    });
  }
  await page.getByRole("tab", { name: /Slide changes/ }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Back to slide", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to projects", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Options for Flat project", exact: true })
    .click();
  await expect(page.getByRole("menuitem")).toHaveCount(2);
  await expect(
    page.getByRole("menuitem", { name: "Open project", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "Duplicate project", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Flat project copy", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open Flat project copy", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Flat project copy", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to projects", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open Flat project", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Flat project copy", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("previous saved projects upgrade without losing slides, notes or transcript", async ({
  page,
}) => {
  await installSpeechSafety(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "All projects", exact: true }),
  ).toBeVisible();
  const saved = fixture();
  saved.projects[0].transcript = [
    {
      id: "prior-session",
      slideId: saved.projects[0].slides[0].id,
      text: "Preserved narration from the previous version.",
      start: 0,
      end: 4,
    },
  ];
  await page.evaluate(
    (saved) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("talkdeck-local-v2", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("workspace", "readwrite");
          tx.objectStore("workspace").put(
            {
              ...saved,
              version: 2,
              obsoleteOrganization: [{ id: "legacy" }],
              projects: saved.projects.map((p) => ({
                ...p,
                obsoleteParent: "legacy",
              })),
            },
            "current",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    saved,
  );
  await page.reload();
  await page
    .getByRole("button", {
      name: `Open ${saved.projects[0].title}`,
      exact: true,
    })
    .click();
  await expect(page.locator(".workspace-sidebar .transcript")).toContainText(
    "Preserved narration from the previous version.",
  );
  await expect(page.locator(".filmstrip-thumbnail")).toHaveCount(
    saved.projects[0].slides.length,
  );
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<unknown>((resolve, reject) => {
            const request = indexedDB.open("talkdeck-local-v2", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result,
                tx = db.transaction("workspace", "readonly"),
                get = tx.objectStore("workspace").get("current");
              get.onsuccess = () => {
                const value = get.result;
                db.close();
                resolve({
                  version: value.version,
                  legacy:
                    "obsoleteOrganization" in value ||
                    "obsoleteParent" in value.projects[0],
                  notes: value.projects[0].slides[0].notes,
                  transcript: value.projects[0].transcript[0].text,
                });
              };
              get.onerror = () => reject(get.error);
            };
          }),
      ),
    )
    .toEqual({
      version: 3,
      legacy: false,
      notes: saved.projects[0].slides[0].notes,
      transcript: "Preserved narration from the previous version.",
    });
});

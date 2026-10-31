import { test, expect, type Page } from "@playwright/test";
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", (error) => list.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
async function createProject(page: Page, title = "Interaction check") {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start with an idea" }),
  ).toBeVisible();
}
async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    class MockRecognition {
      continuous = true;
      interimResults = true;
      lang = "en-US";
      onstart: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (window as any).__recognizer = this;
        setTimeout(() => this.onstart?.(), 0);
      }
      abort() {}
    }
    (window as any).SpeechRecognition = MockRecognition;
  });
}
async function say(page: Page, text: string, final = true, index = 0) {
  await page.evaluate(
    ({ text, final, index }) => {
      const r = (window as any).__recognizer;
      const result: any = [{ transcript: text }];
      result.isFinal = final;
      const results: any[] = Array.from({ length: index + 1 }, () => {
        const a: any = [{ transcript: "" }];
        a.isFinal = true;
        return a;
      });
      results[index] = result;
      r.onresult?.({ resultIndex: index, results });
    },
    { text, final, index },
  );
}
test("fresh creation, exact empty geometry, add/edit, reload and no voice footer", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("No projects yet", { exact: true }),
  ).toBeVisible();
  await createProject(page);
  await expect(page.locator(".voice-dock")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  const box = await page.locator(".slide-empty").boundingBox();
  expect(box!.height).toBeCloseTo(556, 0);
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 2);
  await page.screenshot({ path: "test-results/empty-1280.png" });
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  await page.getByLabel("Slide canvas", { exact: true }).dblclick();
  await page
    .getByRole("dialog")
    .getByLabel("Title", { exact: true })
    .fill("A clear idea");
  await page
    .getByRole("dialog")
    .getByLabel("Content", { exact: true })
    .fill("One point per slide.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".stage .slide-heading")).toHaveText(
    "A clear idea",
  );
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator(".stage .slide-heading")).toHaveText(
    "A clear idea",
  );
  await page.screenshot({ path: "test-results/slides-1280.png" });
});
test("source editor, escaped text, nested folders and exact original download", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("Folder name", { exact: true }).fill("Presentations");
  await page
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  await page.getByRole("treeitem", { name: /Presentations/ }).click();
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Add sources", exact: true }).click();
  await page.getByRole("tab", { name: "Copied text", exact: true }).click();
  await page.getByLabel("Title (optional)").fill("Notes");
  await page
    .getByLabel("Source text")
    .fill("<script>window.bad=true</script>\nPrepared source");
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Notes.txt/ }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Notes.txt/ })
    .first()
    .click();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "<script>",
  );
  expect(await page.evaluate(() => (window as any).bad)).toBeUndefined();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download original", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("Notes.txt");
});
test("rapid cut paste, unique identity, reorder, delete undo and menu guards", async ({
  page,
}) => {
  await createProject(page);
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  const before = await page
    .locator(".filmstrip-thumbnail")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
  await page.locator(".filmstrip-thumbnail").nth(1).focus();
  await page.locator(".filmstrip-thumbnail").nth(1).click();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ControlOrMeta+x");
    await page.keyboard.press("ControlOrMeta+v");
  }
  await expect(page.locator(".filmstrip-thumbnail")).toHaveCount(3);
  const ids = await page
    .locator(".filmstrip-thumbnail")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
  expect(new Set(ids).size).toBe(3);
  expect(ids).not.toEqual(before);
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Delete");
  await expect(page.locator(".filmstrip-thumbnail")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".filmstrip-thumbnail")).toHaveCount(3);
  await page.locator(".filmstrip-thumbnail").first().click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Duplicate", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});
test("real speech lifecycle interface via test-only mock, final dedup, agent editing, audience privacy", async ({
  page,
  context,
}) => {
  await mockSpeech(page);
  await createProject(page);
  await page
    .getByRole("button", { name: "Talk to generate", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("tab", { name: "Transcript", exact: true }),
  ).toBeVisible();
  await page.waitForFunction(() => (window as any).__recognizer);
  await say(page, "A place for ideas");
  await expect(page.locator(".stage .slide-heading")).toHaveText(
    "A place for ideas",
  );
  await say(page, "A place for ideas");
  await expect(page.locator(".filmstrip-thumbnail")).toHaveCount(1);
  await page.getByRole("button", { name: "To the audience" }).click();
  await say(page, "Change the title to Speak clearly", true, 1);
  await expect(page.locator(".stage .slide-heading")).toHaveText(
    "Speak clearly",
  );
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.locator(".voice-dock")).toHaveCount(0);
  await page.getByRole("button", { name: "Audience (A)", exact: true }).click();
  await expect(
    page
      .getByRole("main", { name: "Audience display" })
      .locator(".slide-heading"),
  ).toHaveText("Speak clearly");
  const value = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("talkdeck-audience-output")!),
  );
  expect(value.slide.notes).toBeUndefined();
  expect(value.slide.materials).toBeUndefined();
  expect(value.slide.systemPrompt).toBeUndefined();
  const audience = await context.newPage();
  await audience.goto(`/audience.html?project=${value.projectId}`);
  await expect(audience.locator(".slide-heading")).toHaveText("Speak clearly");
  await page.getByRole("button", { name: "Return", exact: true }).click();
  await audience.close();
});
test("practice overview, proposal approval and completion preserve snapshot", async ({
  page,
}) => {
  await mockSpeech(page);
  await createProject(page);
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  await page.getByLabel("Slide canvas", { exact: true }).dblclick();
  await page
    .getByRole("dialog")
    .getByLabel("Title", { exact: true })
    .fill("Practice a story");
  await page
    .getByRole("dialog")
    .getByLabel("Content", { exact: true })
    .fill(
      "A database keeps related records together so we can find the information we need without copying it into many separate files.",
    );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.waitForFunction(() => (window as any).__recognizer);
  await say(
    page,
    "This thing keeps our customer records together. Each row is one person.",
  );
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  for (const width of [1512, 786]) {
    await page.setViewportSize({ width, height: width === 1512 ? 900 : 853 });
    await page.screenshot({ path: `docs/evidence/overview-${width}.png` });
  }
  await page.getByRole("tab", { name: /Slide changes/ }).click();
  for (const width of [1512, 786, 390]) {
    await page.setViewportSize({ width, height: width === 1512 ? 900 : 853 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: `docs/evidence/diff-${width}.png` });
  }
  await page.setViewportSize({ width: 1512, height: 900 });
  await page.screenshot({ path: "test-results/review.png" });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review complete", exact: true }),
  ).toBeVisible();
  for (const width of [1512, 786]) {
    await page.setViewportSize({ width, height: width === 1512 ? 900 : 853 });
    await page.screenshot({ path: `docs/evidence/completion-${width}.png` });
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByLabel("Slide canvas", { exact: true })).toBeVisible();
});
test("responsive containment and required desktop/narrow screenshots", async ({
  page,
}) => {
  await createProject(page);
  for (const [width, height] of [
    [1512, 900],
    [1280, 900],
    [919, 853],
    [786, 853],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    const box = await page.locator(".slide-empty").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `docs/evidence/empty-${width}.png` });
  }
  await page.getByRole("button", { name: "Add slide", exact: true }).click();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  for (const width of [1512, 786, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: `test-results/sidebar-${width}.png` });
  }
});

import { fixture } from "./fixture";
async function seed(page: Page) {
  await page.goto("/");
  await expect(
    page.getByText("No projects yet", { exact: true }),
  ).toBeVisible();
  await page.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("talkdeck-local-v2", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(data, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, fixture());
  await page.reload();
}

test("all required screen evidence, themes, drawing tools and present fullscreen", async ({
  page,
}) => {
  await mockSpeech(page);
  await seed(page);
  async function shots(name: string) {
    for (const width of [1512, 786]) {
      await page.setViewportSize({ width, height: width === 1512 ? 900 : 853 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({ path: `docs/evidence/${name}-${width}.png` });
    }
  }
  await shots("dashboard");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await shots("setup");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.locator(".project-card-open").first().click();
  await shots("slides");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("menuitem", { name: "Midnight", exact: true }).click();
  await expect(page.locator(".stage .slide-theme-midnight")).toHaveCount(1);
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("menuitem", { name: "Paper", exact: true }).click();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByRole("button", { name: "Pen (hold D)", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pen (hold D)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.down("h");
  await expect(
    page.getByRole("button", { name: "Highlighter (hold H)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("h");
  await expect(
    page.getByRole("button", { name: "Pen (hold D)", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Pen (hold D)", exact: true }).click();
  const b = await page.getByLabel("Slide annotations").boundingBox();
  await page.mouse.move(b!.x + 70, b!.y + 70);
  await page.mouse.down();
  await page.mouse.move(b!.x + 120, b!.y + 90);
  await page.mouse.up();
  await expect(page.getByText("1 marks", { exact: true })).toBeVisible();
  await shots("palette");
  await page
    .getByRole("button", { name: "Close drawing tools", exact: true })
    .click();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await shots("context");
  await page
    .getByRole("button", { name: "Talk to generate", exact: true })
    .first()
    .click();
  await page.waitForFunction(() => (window as any).__recognizer);
  await shots("talk");
  await page.getByRole("button", { name: "To the audience" }).click();
  await shots("talk-agent");
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await shots("presenter");
  await page.getByRole("button", { name: "Audience (A)", exact: true }).click();
  await shots("audience");
  await page.getByRole("button", { name: "Return", exact: true }).click();
  await page
    .getByRole("button", { name: "Fullscreen (F)", exact: true })
    .click();
  await expect(page.locator(".fullscreen-slide")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "End", exact: true }).click();
});
test("CSV import spoken lookup, real export files, missing routes recover", async ({
  page,
}) => {
  await mockSpeech(page);
  await createProject(page, "Export check");
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await page.getByRole("button", { name: "Add sources", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("customer_id,name\n1,Linh\n2,Minh\n3,An"),
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Talk to generate", exact: true })
    .first()
    .click();
  await page.waitForFunction(() => (window as any).__recognizer);
  await say(page, "Show the Customers table");
  await expect(page.locator(".stage .slide-table tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const pptx = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "PowerPoint (.pptx)", exact: true })
    .click();
  const ppt = await pptx;
  expect(ppt.suggestedFilename()).toBe("Export check.pptx");
  await ppt.saveAs("test-results/export-check.pptx");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const pdf = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "PDF (.pdf)", exact: true }).click();
  const p = await pdf;
  expect(p.suggestedFilename()).toBe("Export check.pdf");
  await p.saveAs("test-results/export-check.pdf");
  await page.goto("/#project/missing/edit");
  await expect(
    page.getByRole("heading", { name: "All projects", exact: true }),
  ).toBeVisible();
});
test("cancelled recognizer cannot write, pending interim is retained honestly on Finish", async ({
  page,
}) => {
  await mockSpeech(page);
  await createProject(page);
  await page
    .getByRole("button", { name: "Talk to generate", exact: true })
    .first()
    .click();
  await page.waitForFunction(() => (window as any).__recognizer);
  await say(page, "An unfinished idea", false);
  await expect(page.locator(".interim")).toContainText("An unfinished idea");
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.locator(".transcript")).toContainText("An unfinished idea");
  await expect(page.locator(".transcript")).toContainText("Unfinished phrase");
  await page.evaluate(() => {
    const r = (window as any).__recognizer;
    r.onresult?.({
      resultIndex: 0,
      results: [
        Object.assign([{ transcript: "Late words" }], { isFinal: true }),
      ],
    });
  });
  await expect(page.locator(".slide-empty")).toHaveCount(1);
});

test("save failure keeps working state and recovers on retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if ((window as any).__failSave)
        throw new DOMException("Storage full", "QuotaExceededError");
      return nativePut.apply(this, args);
    };
  });
  await createProject(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__failSave = true;
  });
  await page
    .getByRole("dialog")
    .getByLabel("Title", { exact: true })
    .fill("Unsaved title");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not saved");
  await expect(
    page.getByRole("heading", { name: "Unsaved title", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).__failSave = false;
  });
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Unsaved title", exact: true }),
  ).toBeVisible();
});
test("practice navigation cancels old utterance before attributing new speech", async ({
  page,
}) => {
  await mockSpeech(page);
  await seed(page);
  await page.locator(".project-card-open").first().click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.waitForFunction(() => (window as any).__recognizer);
  await say(page, "First slide explanation", false);
  await page.evaluate(() => {
    (window as any).__late = (window as any).__recognizer.onresult;
  });
  await page.getByRole("button", { name: "Next slide", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__late?.({
      resultIndex: 0,
      results: [
        Object.assign([{ transcript: "First slide explanation" }], {
          isFinal: true,
        }),
      ],
    });
  });
  await say(page, "Second slide explanation");
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeVisible();
  const transcript = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("talkdeck-local-v2", 1);
      r.onsuccess = () => resolve(r.result);
    });
    return await new Promise<any[]>((resolve) => {
      const request = db
        .transaction("workspace")
        .objectStore("workspace")
        .get("current");
      request.onsuccess = () =>
        resolve(request.result.projects[0].rehearsals.at(-1).transcript);
    });
  });
  expect(transcript).toHaveLength(2);
  expect(transcript.map((t) => t.slideId)).toEqual(["slide-0", "slide-1"]);
});

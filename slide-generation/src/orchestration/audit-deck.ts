/** Audit actual rendered deck text and recorded control flow, not model claims. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
if (!process.argv[2])
  throw new Error("Pass a completed deck fixture run directory");
const directory = resolve(process.argv[2]);
const summary = JSON.parse(
  readFileSync(join(directory, "summary.json"), "utf8"),
);
const rows = readFileSync(join(directory, "events.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s));
const browser = await chromium.launch({ headless: true });
const texts: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("https://assets.talkdeck.local/")) {
      const hash = url.split("/").at(-1)!.split("#")[0];
      if (!/^[a-f0-9]{64}$/.test(hash)) return route.abort();
      try {
        const metadata = JSON.parse(
          readFileSync(join(directory, "assets", hash + ".json"), "utf8"),
        );
        return route.fulfill({
          contentType: metadata.mediaType,
          body: readFileSync(join(directory, "assets", hash)),
        });
      } catch {
        return route.abort();
      }
    }
    await route.abort();
  });
  for (let i = 0; i < summary.slides.length; i++) {
    await page.setContent(
      readFileSync(join(directory, `slide-${i + 1}.html`), "utf8"),
      { waitUntil: "networkidle" },
    );
    texts.push(await page.locator("body").innerText());
  }
} finally {
  await browser.close();
}
const at = (n: number) => texts[n - 1] ?? "",
  has = (n: number, re: RegExp) => re.test(at(n));
let selected = summary.routed[0]?.slideId,
  pastRefinement = false,
  paused = false,
  publishedWhilePaused = false;
for (const r of rows) {
  if (r.type === "slide_selected") selected = r.slideId;
  if (r.type === "work_paused") paused = true;
  if (r.type === "work_resumed") paused = false;
  if (r.type === "published") {
    if (paused) publishedWhilePaused = true;
    if (r.role === "slow" && r.slideId !== selected) pastRefinement = true;
  }
}
const checks = {
  completedWithoutError: !summary.error,
  fiveSlidesNarrated:
    summary.routed.length === 5 &&
    summary.routed.every((r: any) => r.transcript?.trim()),
  fivePlannedSlidesRetained: summary.slides.length === 5,
  agentsIdle: summary.statuses.every(
    (a: any) =>
      a.state === "idle" ||
      (a.role === "specialist" &&
        a.state === "failed" &&
        a.failureObservedByParent),
  ),
  stayedOnLastSelection: summary.selectedId === summary.routed.at(-1)?.slideId,
  pauseExercised: summary.pauseExercised === true,
  noPublicationDuringPause: !summary.pausedPublication && !publishedWhilePaused,
  refinedPastSlide: pastRefinement,
  renderValid: summary.slides.every((s: any) =>
    s.diagnostics.every((d: any) => d.severity !== "error"),
  ),
  populatedDistinctSlides:
    texts.length === 5 &&
    new Set(texts).size === 5 &&
    texts.every(
      (t) => t.length > 100 && !t.includes("Listening for your first idea"),
    ),
  trialCohort: has(2, /48/) && has(2, /60/),
  correctedPriorRating:
    has(3, /3[.,]2/) && has(3, /4[.,]4/) && !has(3, /4[.,]6/),
  timeComparison: has(3, /20/) && has(3, /5/) && has(3, /75/),
  firstVisitComparison: has(3, /80/) && has(3, /95/),
  staffingCost: has(4, /30/),
  scenarioNotMeasured:
    has(4, /150/) &&
    has(4, /120|2\s*(hours|hrs)|two hours/i) &&
    has(4, /illustrat|scenario|not measured|not a measured/i),
  boundedRecommendation:
    has(5, /month|four.week|4.week/i) && has(5, /textbook/i),
  thresholdsNotOutcomes:
    has(5, /proposed|threshold|target/i) &&
    has(5, /5/) &&
    has(5, /95/) &&
    has(5, /30/),
};
const result = {
  passed: Object.values(checks).every(Boolean),
  checks,
  visibleText: texts,
};
writeFileSync(join(directory, "audit.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: result.passed, checks }, null, 2));
if (!result.passed) process.exitCode = 1;

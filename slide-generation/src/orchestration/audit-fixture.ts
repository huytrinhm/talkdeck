import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
const directory = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: npm run audit -- runs/<run>");
const summary = JSON.parse(
  readFileSync(join(directory, "summary.json"), "utf8"),
);
const rows = readFileSync(join(directory, "events.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.route("**/*", (route) => route.abort());
await page.setContent(readFileSync(join(directory, "final.html"), "utf8"));
const text = await page.locator("body").innerText();
await browser.close();
const checks = {
  completedWithoutError: !summary.error,
  agentsFinished: summary.statuses.every(
    (s: { state: string; role: string; failureObservedByParent?: boolean }) =>
      s.state === "idle" ||
      (s.role === "specialist" &&
        s.state === "failed" &&
        s.failureObservedByParent === true),
  ),
  renderValid: !summary.diagnostics.some(
    (d: { severity: string }) => d.severity === "error",
  ),
  streamedAudio: rows.some(
    (r) =>
      r.type === "transcription_event" &&
      r.event.type === "conversation.item.input_audio_transcription.delta",
  ),
  finalTranscriptEvaluated:
    summary.transcriptRevision ===
    (summary.evaluatedRevision ?? summary.dispatchedRevision),
  incrementalPublication: summary.publications >= 2,
  slowRefinement: rows.some(
    (r) => r.type === "publication" && r.role === "slow",
  ),
  correctParticipants: /\b48\b/.test(text) && /\b60\b/.test(text),
  timeComparison:
    /(?:^|\D)20(?:\D|$)/.test(text) &&
    /(?:^|\D)5(?:\D|$)/.test(text) &&
    /75\s*%/.test(text),
  firstVisitComparison: /80\s*%/.test(text) && /95\s*%/.test(text),
  correctedSatisfaction:
    /3\.2/.test(text) && /4\.4/.test(text) && !/4\.6/.test(text),
  process:
    /reserve/i.test(text) && /collect/i.test(text) && /pick.?up/i.test(text),
  staffingCaveat: /30/.test(text) && /staff/i.test(text),
  recommendation: /month/i.test(text) && /high.demand/i.test(text),
};
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? Math.round(sorted[Math.floor((sorted.length - 1) * fraction)])
    : null;
}
const decisions = rows
  .filter((r) => r.type === "decision_api")
  .map((r) => r.latencyMs);
const fast = rows
  .filter((r) => r.type === "model_response" && r.agent === "fast")
  .map((r) => r.latencyMs);
const firstTranscript = rows.find((r) => r.type === "transcript")?.at;
const firstPublication = rows.find((r) => r.type === "publication")?.at;
const audit = {
  checks,
  passed: Object.values(checks).every(Boolean),
  metrics: {
    decisions: decisions.length,
    decisionP50Ms: percentile(decisions, 0.5),
    decisionP95Ms: percentile(decisions, 0.95),
    fastP50Ms: percentile(fast, 0.5),
    fastP95Ms: percentile(fast, 0.95),
    firstTranscriptToPublicationMs: firstPublication - firstTranscript,
    publications: summary.publications,
    staleEditsRejected: rows.filter(
      (r) =>
        r.type === "edit_rejected" &&
        r.diagnostics.some((d: { code: string }) => d.code === "conflict"),
    ).length,
    specialistArtifactCalls: rows.filter(
      (r) => r.type === "tool_result" && r.name === "save_artifact",
    ).length,
  },
  visibleText: text,
};
writeFileSync(join(directory, "audit.json"), JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit, null, 2));
if (!audit.passed) process.exitCode = 1;

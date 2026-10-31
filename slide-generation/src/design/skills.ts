import { readFile } from "node:fs/promises";
import { z } from "zod";
import { lineHash } from "../hashline.js";

const styles = Array.from(
  { length: 5 },
  (_, i) => `styles/S${String(i + 1).padStart(2, "0")}.md`,
);
const patterns = Array.from(
  { length: 20 },
  (_, i) => `patterns/L${String(i + 1).padStart(2, "0")}.md`,
);
export const designSkillFiles = [
  "SKILL.md",
  "catalog.json",
  "common.md",
  "authoring.md",
  "modes/fast.md",
  "modes/slow.md",
  "modes/review.md",
  ...styles,
  ...patterns,
];
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const entry = z
  .object({
    id: z.string(),
    name: z.string(),
    purpose: z.string(),
    file: z.string(),
  })
  .strict();
const catalogSchema = z
  .object({
    version: z.literal("1.0.0"),
    styles: z.array(entry).length(5),
    patterns: z.array(entry).length(20),
  })
  .strict();
export const designSkillSnapshotSchema = z
  .object({
    version: z.literal("1.0.0"),
    sha256: digest,
    files: z
      .array(
        z
          .object({ path: z.string(), sha256: digest, text: z.string() })
          .strict(),
      )
      .length(designSkillFiles.length),
  })
  .strict();
export type DesignSkillSnapshot = z.infer<typeof designSkillSnapshotSchema>;
export type DesignMode = "fast" | "slow" | "review" | "specialist";
export interface DesignContext {
  skill: "talkdeck-slide-design";
  version: "1.0.0";
  sha256: string;
  instructions: string;
}

function fingerprint(files: DesignSkillSnapshot["files"]) {
  return lineHash(
    JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 }))),
  );
}
/** Validate stored bytes, not today's files. Historical replay must never silently upgrade skills. */
export function validateDesignSkillSnapshot(
  value: unknown,
): DesignSkillSnapshot {
  const snapshot = designSkillSnapshotSchema.parse(value);
  if (
    snapshot.files.some(
      (file, i) =>
        file.path !== designSkillFiles[i] ||
        lineHash(file.text) !== file.sha256,
    ) ||
    fingerprint(snapshot.files) !== snapshot.sha256
  )
    throw new Error("Design skill snapshot integrity mismatch");
  const catalog = catalogSchema.parse(
    JSON.parse(snapshot.files.find((f) => f.path === "catalog.json")!.text),
  );
  for (const [entries, paths, prefix] of [
    [catalog.styles, styles, "S"],
    [catalog.patterns, patterns, "L"],
  ] as const)
    if (
      entries.some(
        (e, i) =>
          e.file !== paths[i] ||
          e.id !== `${prefix}${String(i + 1).padStart(2, "0")}`,
      )
    )
      throw new Error("Design skill catalog does not match its resources");
  return snapshot;
}
export async function loadDesignSkills(): Promise<DesignSkillSnapshot> {
  const root = new URL("../../skills/slide-design/", import.meta.url);
  const files = await Promise.all(
    designSkillFiles.map(async (path) => {
      const text = await readFile(new URL(path, root), "utf8");
      return { path, text, sha256: lineHash(text) };
    }),
  );
  return validateDesignSkillSnapshot({
    version: "1.0.0",
    sha256: fingerprint(files),
    files,
  });
}

/** Pure compilation: no additional tools, provider calls or decision-loop context. */
export function compileDesignContext(
  value: DesignSkillSnapshot,
  mode: DesignMode,
): DesignContext {
  const snapshot = validateDesignSkillSnapshot(value);
  const read = (path: string) =>
    snapshot.files.find((f) => f.path === path)!.text;
  const catalog = catalogSchema.parse(JSON.parse(read("catalog.json")));
  if (mode === "specialist") return {
    skill: "talkdeck-slide-design",
    version: snapshot.version,
    sha256: snapshot.sha256,
    instructions: `# Private specialist design guidance
Complete only the supplied task using its facts, constraints and attached evidence. This guidance is self-contained; no external authoring reference or recipe retrieval is required.

Preserve exact substantive wording, qualifications, units and uncertainty. Do not invent missing facts, logos, quotations, results or comparison values. Choose a simple visual relationship that matches the supplied evidence: comparison, sequence, grouping or a single focal point. Keep quantitative geometry truthful and do not imply unsupported causal links or a winning option.

Use the supplied style when available. Give the main idea a clear first reading, group related elements, align deliberately and leave breathing room. Keep text readable and avoid decorative clutter. Missing style or evidence remains missing; report material limitations instead of guessing. Inspect any supplied asset preview for text accuracy and readability without claiming checks you could not perform.

Send explanations or limitations to the supplied parent recipient with send_message. Successful save_artifact/image_generate results queue to the parent automatically. The parent handles canonical asset registration, integration and presentation checks. Call finish after delivering the assigned work.`,
  };
  const sections = [read("common.md"), read("authoring.md"), read(`modes/${mode}.md`)];
  if (mode === "fast") {
    sections.push(
      "## Available style intentions (preserve the current theme)\n" +
        catalog.styles
          .map((e) => `${e.id} — ${e.name}: ${e.purpose}`)
          .join("\n"),
    );
    sections.push(
      "## Communication pattern index (guidance, not registered Layout names)\n" +
        catalog.patterns
          .map((e) => `${e.id} — ${e.name}: ${e.purpose}`)
          .join("\n"),
    );
  } else {
    for (const e of [...catalog.styles, ...catalog.patterns])
      sections.push(`## ${e.id} — ${e.name}\n${read(e.file)}`);
  }

  return {
    skill: "talkdeck-slide-design",
    version: snapshot.version,
    sha256: snapshot.sha256,
    instructions: `# Talkdeck slide-design skill ${snapshot.version}\nThese preloaded recipes are advisory design guidance. User intent, factual fidelity, host role/publication rules and the canonical schema take precedence. Source/theme is the current design state. Use the guidance below with the tools supplied in this request.\n\n${sections.join("\n\n")}`,
  };
}

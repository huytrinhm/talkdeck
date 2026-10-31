import {
  blankSlide,
  uid,
  type Project,
  type Slide,
  type Layout,
  type Theme,
} from "./types";
export interface SlideClipboard {
  projectId: string;
  slide: Slide;
}
export type SlideOperation =
  | "add-before"
  | "add-after"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "delete"
  | "move-left"
  | "move-right";
export interface CommandResult {
  project: Project;
  selectedId: string | null;
  message?: string;
  clipboard?: SlideClipboard;
}
const clone = <T>(x: T): T => structuredClone(x);
const changed = (p: Project, slides: Slide[]): Project => ({
  ...p,
  slides,
  updatedAt: Date.now(),
});
export function slideOperation(
  project: Project,
  selectedId: string | null,
  operation: SlideOperation,
  clipboard?: SlideClipboard,
): CommandResult {
  const index = project.slides.findIndex((s) => s.id === selectedId),
    slide = project.slides[index];
  const result: CommandResult = { project, selectedId, clipboard };
  const slides = [...project.slides];
  if (operation === "copy" || operation === "cut") {
    if (!slide) return result;
    result.clipboard = { projectId: project.id, slide: clone(slide) };
    if (operation === "copy") return result;
  }
  if (operation === "delete" || operation === "cut") {
    if (!slide) return result;
    slides.splice(index, 1);
    result.selectedId = slides[Math.min(index, slides.length - 1)]?.id ?? null;
  } else if (operation === "move-left" || operation === "move-right") {
    const to = index + (operation === "move-left" ? -1 : 1);
    if (!slide || to < 0 || to >= slides.length) return result;
    slides.splice(index, 1);
    slides.splice(to, 0, slide);
  } else {
    let inserted: Slide;
    if (operation === "paste") {
      if (!clipboard) return { ...result, message: "Copy a slide first." };
      inserted = { ...clone(clipboard.slide), id: uid() };
      if (clipboard.projectId !== project.id) delete inserted.materialRef;
    } else if (operation === "duplicate") {
      if (!slide) return result;
      inserted = { ...clone(slide), id: uid() };
    } else inserted = blankSlide(project.theme);
    slides.splice(
      index < 0 ? slides.length : index + (operation === "add-before" ? 0 : 1),
      0,
      inserted,
    );
    result.selectedId = inserted.id;
  }
  return { ...result, project: changed(project, slides) };
}
export function applyUtterance(
  project: Project,
  selectedId: string | null,
  text: string,
  target: "audience" | "agent",
  mode: "create" | "present" | "practice",
): CommandResult {
  const raw = text.trim().replace(/[.!?]+$/, "");
  const lower = raw.toLowerCase();
  const current = project.slides.findIndex((s) => s.id === selectedId);
  const base = { project, selectedId };
  if (!raw) return base;
  const hint = (message: string) => ({ ...base, message });
  const select = (i: number): CommandResult =>
    i >= 0 && i < project.slides.length
      ? { ...base, selectedId: project.slides[i].id }
      : hint("That slide is outside this presentation.");
  if (
    /\b(?:do not|don't|never)\b.*\b(?:next|previous|back|go|slide)\b/i.test(raw)
  )
    return base;
  const leadingNavigation = raw.match(
    /^(next slide|previous slide|go back)[,.:;]\s*(.+)$/i,
  );
  if (leadingNavigation) {
    const navigated = applyUtterance(
      project,
      selectedId,
      leadingNavigation[1],
      target,
      mode,
    );
    return mode === "create" && target === "audience" && !navigated.message
      ? applyUtterance(
          navigated.project,
          navigated.selectedId,
          leadingNavigation[2],
          target,
          mode,
        )
      : navigated;
  }
  const nav = raw.match(/^(?:go to|switch to|show|jump to) (?:slide )?(.+)$/i);
  if (
    /^(?:next slide|go forward|previous slide|go back|first slide|last slide)$/i.test(
      raw,
    )
  ) {
    if (lower === "next slide" && mode === "create" && target === "audience") {
      if (current === project.slides.length - 1)
        return slideOperation(project, selectedId, "add-after");
    }
    return select(
      lower === "first slide"
        ? 0
        : lower === "last slide"
          ? project.slides.length - 1
          : current + (/back|previous/.test(lower) ? -1 : 1),
    );
  }
  if (nav && !/\btable\b/i.test(nav[1])) {
    const v = nav[1].trim();
    if (/^(?:first|last)(?: slide)?$/i.test(v))
      return select(/^first/i.test(v) ? 0 : project.slides.length - 1);
    if (/^\d+$/.test(v)) return select(Number(v) - 1);
    const matches = project.slides
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.title.toLowerCase() === v.toLowerCase());
    if (matches.length === 1) return select(matches[0].i);
    if (matches.length > 1)
      return hint("More than one slide has that title. Use a slide number.");
    if (/^(?:go|switch|jump)/i.test(raw))
      return hint("No slide matches that reference.");
  }
  if (
    mode !== "create" &&
    /^(?:now |let(?:'s| us) |moving on|next[, :])/i.test(raw)
  ) {
    const matches = project.slides
      .map((s, i) => ({ s, i }))
      .filter(
        ({ s, i }) =>
          i !== current &&
          s.title.trim().split(/\s+/).length >= 2 &&
          lower.includes(s.title.toLowerCase()),
      );
    if (matches.length === 1) return select(matches[0].i);
    if (matches.length > 1)
      return hint(
        "That transition matches several slides. Use a slide number.",
      );
  }
  if (mode === "practice")
    return /^(?:change|set|add|replace|make|use|move|show)/i.test(raw)
      ? hint("Practice only follows slide navigation; slides stay unchanged.")
      : base;
  let editIndex = current,
    command = raw;
  const addressed = raw.match(/^on slide (\d+)[,:]?\s+(.+)$/i);
  if (addressed) {
    editIndex = Number(addressed[1]) - 1;
    command = addressed[2];
    if (!project.slides[editIndex])
      return hint("That slide is outside this presentation.");
  }
  const edit = (fn: (s: Slide) => Slide): CommandResult => {
    if (editIndex < 0) return hint("Add a slide first.");
    return {
      ...base,
      project: changed(
        project,
        project.slides.map((s, i) => (i === editIndex ? fn(clone(s)) : s)),
      ),
    };
  };
  const table = command.match(/^(?:show|use|insert) (?:the )?(.+?) table$/i);
  if (table) {
    const name = table[1].toLowerCase();
    const matches = project.materials.flatMap((m) =>
      (m.tables ?? [])
        .filter((t) =>
          [t.name, ...(t.aliases ?? [])].some((n) => n.toLowerCase() === name),
        )
        .map((t) => ({ m, t })),
    );
    if (matches.length !== 1)
      return hint(
        matches.length
          ? "That table name is ambiguous. Rename the source table."
          : "No imported table matches that name.",
      );
    const { m, t } = matches[0];
    if (editIndex < 0) {
      const r = slideOperation(project, selectedId, "add-after");
      return applyUtterance(r.project, r.selectedId, text, target, mode);
    }
    return edit((s) => ({
      ...s,
      title: t.name,
      body: [],
      layout: "table",
      tableData: clone(t),
      materialRef: { materialId: m.id, tableName: t.name, page: 0 },
    }));
  }
  const page = command.match(/^(next|previous) (?:table )?page$/i);
  if (page)
    return edit((s) => {
      if (!s.tableData) return s;
      const max = Math.max(0, Math.ceil(s.tableData.rows.length / 8) - 1);
      return {
        ...s,
        materialRef: s.materialRef
          ? {
              ...s.materialRef,
              page: Math.min(
                max,
                Math.max(
                  0,
                  (s.materialRef.page ?? 0) +
                    (page[1].toLowerCase() === "next" ? 1 : -1),
                ),
              ),
            }
          : undefined,
      };
    });
  const move = command.match(
    /^move slide (\d+) (before|after) (?:slide )?(\d+)$/i,
  );
  if (move) {
    const from = Number(move[1]) - 1,
      to = Number(move[3]) - 1;
    if (!project.slides[from] || !project.slides[to])
      return hint("That slide is outside this presentation.");
    if (from === to) return base;
    const slides = [...project.slides];
    const [s] = slides.splice(from, 1);
    const anchor = slides.findIndex((x) => x.id === project.slides[to].id);
    slides.splice(anchor + (move[2].toLowerCase() === "after" ? 1 : 0), 0, s);
    return { ...base, project: changed(project, slides) };
  }
  let m = command.match(/^(?:change|set) (?:the )?title to (.+)$/i);
  if (m) return edit((s) => ({ ...s, title: m![1] }));
  m = command.match(/^(?:set|change) (?:the )?(?:content|body) to (.+)$/i);
  if (m)
    return edit((s) => {
      delete s.tableData;
      delete s.materialRef;
      return {
        ...s,
        body: m![1].split(/\s*[;\n]\s*/).filter(Boolean),
        layout: "bullets",
      };
    });
  m = command.match(/^add (?:a )?(?:bullet|point)\s+(.+)$/i);
  if (m)
    return edit((s) => {
      delete s.materialRef;
      delete s.tableData;
      return { ...s, layout: "bullets", body: [...s.body, m![1]] };
    });
  m = command.match(/^replace (.+?) with (.+)$/i);
  if (m)
    return edit((s) => {
      delete s.materialRef;
      return {
        ...s,
        title: s.title.split(m![1]).join(m![2]),
        body: s.body.map((b) => b.split(m![1]).join(m![2])),
      };
    });
  if (/^(?:make (?:this|it) shorter|shorten(?: this)?)$/i.test(command))
    return edit((s) => {
      delete s.materialRef;
      return {
        ...s,
        body: s.body
          .map((b) => b.split(/\s+/).slice(0, 14).join(" "))
          .slice(0, 5),
      };
    });
  m = command.match(/^use (paper|midnight|lavender) theme(.*)$/i);
  if (m) {
    const theme = m[1].toLowerCase() as Theme;
    if (/whole|entire|all|presentation|deck/i.test(m[2]))
      return {
        ...base,
        project: {
          ...changed(
            project,
            project.slides.map((s) => ({ ...s, theme })),
          ),
          theme,
        },
      };
    return edit((s) => ({ ...s, theme }));
  }
  m = command.match(
    /^(?:use|switch to) (title|bullets|process|comparison|quote|table|code) layout$/i,
  );
  if (m) return edit((s) => ({ ...s, layout: m![1].toLowerCase() as Layout }));
  if (
    target === "agent" ||
    /^(?:change|set|replace|make|use|move|delete|remove|add|show|switch)\b/i.test(
      command,
    )
  )
    return hint(
      "That instruction is not supported by the local command rules.",
    );
  if (mode !== "create") return base;
  const sentences = raw.split(/(?<=[.!?])\s+/).filter(Boolean);
  let slides = clone(project.slides);
  let index = current;
  if (index < 0 || slides[index].body.length >= 5) {
    const s = blankSlide(project.theme);
    slides.push(s);
    index = slides.length - 1;
  }
  const s = slides[index];
  if (s.title === "Untitled slide" && s.body.length === 0) {
    s.title = sentences.shift()!;
  }
  s.body.push(...sentences);
  if (s.body.length) s.layout = "bullets";
  return { project: changed(project, slides), selectedId: s.id };
}

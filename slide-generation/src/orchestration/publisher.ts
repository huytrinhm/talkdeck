import { randomUUID } from "node:crypto";
import { merge, replaceExactly } from "./merge.js";
import {
  blankSlide,
  diagnostic,
  errorMessage,
  silentLog,
  type Log,
  type Observation,
  type Renderer,
  type Role,
  type Speech,
  type Diagnostic,
} from "./types.js";
export interface Edit {
  old: string;
  new: string;
}
export interface Branch {
  historyEpoch: number;
  id: string;
  agent: string;
  role: Role;
  source: string;
  slideId?: string;
  speech?: Speech;
}
export interface EditResult {
  outcome: "published" | "unchanged" | "rejected";
  current: Observation;
  diagnostics: Diagnostic[];
}
export interface SlideRecord {
  id: string;
  title: string;
  observation: Observation;
}
export interface DeckSnapshot {
  selectedId: string;
  slides: SlideRecord[];
}
export interface StructureResult {
  outcome: "published" | "rejected";
  slideIds: string[];
  diagnostics: Diagnostic[];
}
export interface HistoryResult {
  outcome: "restored" | "unchanged";
  direction: "undo" | "redo";
  selectedId: string;
  history: {
    undoDepth: number;
    redoDepth: number;
    canUndo: boolean;
    canRedo: boolean;
  };
}
export class Publisher {
  private slides = new Map<string, SlideRecord>();
  private order: string[] = [];
  selectedId = "";
  revision = 0;
  fastWatermark = 0;
  latestFastSlideId = "";
  undo: Observation[] = [];
  deckUndo: DeckSnapshot[] = [];
  deckRedo: DeckSnapshot[] = [];
  historyEpoch = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private forwarded = new Set<string>();
  onPublish?: (observation: Observation, role: Role) => void;
  onStructure?: (result: StructureResult) => void;
  onConflict?: (intent: {
    id: string;
    slideId?: string;
    edit: Edit;
    speech?: Speech;
    diagnostics: Diagnostic[];
  }) => void;
  closed = false;
  paused = false;
  pauseEpoch = 0;
  setPaused(value: boolean) {
    if (value && !this.paused) this.pauseEpoch++;
    this.paused = value;
  }
  validateAccess?: (role: Role, source: string) => Diagnostic[];
  constructor(
    private renderer: Renderer,
    private log: Log = silentLog,
  ) {}
  get current(): Observation {
    return this.get(this.selectedId).observation;
  }
  get(id: string): SlideRecord {
    const s = this.slides.get(id);
    if (!s) throw new Error(`Unknown or removed slide ${id}`);
    return s;
  }
  list(): SlideRecord[] {
    return this.order.map((id) => this.get(id));
  }
  snapshot(): DeckSnapshot {
    return {
      selectedId: this.selectedId,
      slides: this.list().map((s) => ({ ...s })),
    };
  }
  historyStatus() {
    return {
      undoDepth: this.deckUndo.length,
      redoDepth: this.deckRedo.length,
      canUndo: this.deckUndo.length > 0,
      canRedo: this.deckRedo.length > 0,
    };
  }
  private recordUndo(previous = this.current) {
    this.deckUndo.push(this.snapshot());
    this.undo.push(previous);
    this.deckRedo.length = 0;
  }
  /** Invalidate old branches immediately, including candidates currently rendering. */
  restoreHistory(direction: "undo" | "redo"): Promise<HistoryResult> {
    this.historyEpoch++;
    const operation = this.serialize<HistoryResult>(async () => {
      if (this.closed) throw new Error("Publisher is closed");
      const from = direction === "undo" ? this.deckUndo : this.deckRedo;
      const to = direction === "undo" ? this.deckRedo : this.deckUndo;
      const snapshot = from.at(-1);
      if (!snapshot)
        return {
          outcome: "unchanged",
          direction,
          selectedId: this.selectedId,
          history: this.historyStatus(),
        };
      const previous = this.snapshot();
      // Cached frames were already validated; assets are immutable. Fresh observation
      // IDs and epochs prevent ABA edits even if a restored source is identical.
      const slides = snapshot.slides.map((s) => ({
        ...s,
        observation: {
          ...s.observation,
          id: randomUUID(),
          historyEpoch: this.historyEpoch,
          fastWatermark: this.fastWatermark,
        },
      }));
      for (const s of slides) this.log.observation(s.observation);
      this.log.write("history_restored", {
        direction,
        slideIds: slides.map((s) => s.id),
      });
      from.pop();
      to.push(previous);
      if (direction === "undo") this.undo.pop();
      else this.undo.push(this.current);
      this.slides = new Map(slides.map((s) => [s.id, s]));
      this.order = slides.map((s) => s.id);
      // Navigation itself is not undoable; keep the user's current selection if possible.
      if (!this.slides.has(this.selectedId))
        this.selectedId = snapshot.selectedId;
      this.revision++;
      this.notifyStructure(this.order);
      return {
        outcome: "restored",
        direction,
        selectedId: this.selectedId,
        history: this.historyStatus(),
      };
    });
    return operation.finally(() => {
      // Failed logging and empty stacks still leave live sources editable.
      for (const slide of this.slides.values())
        slide.observation = {
          ...slide.observation,
          historyEpoch: this.historyEpoch,
        };
    });
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.chain.then(work);
    this.chain = operation.catch(() => {});
    return operation;
  }
  async initialize(source: string) {
    const id = randomUUID(),
      observation = await this.render(source, id);
    this.slides.set(id, { id, title: "Slide 1", observation });
    this.order = [id];
    this.selectedId = id;
    this.log.observation(observation);
  }
  private async render(source: string, slideId: string): Promise<Observation> {
    const result = await this.renderer.render(source);
    if (result.diagnostics.some((d) => d.severity === "error"))
      throw new Error(JSON.stringify(result.diagnostics));
    return {
      ...result,
      historyEpoch: this.historyEpoch,
      source,
      slideId,
      id: randomUUID(),
      fastWatermark: this.fastWatermark,
    };
  }
  async navigate(slideId: string): Promise<SlideRecord> {
    return this.serialize(async () => {
      if (this.closed) throw new Error("Publisher is closed");
      const slide = this.get(slideId);
      this.selectedId = slideId;
      return slide;
    });
  }
  async next(): Promise<SlideRecord> {
    const historyEpoch = this.historyEpoch;
    return this.serialize(async () => {
      if (this.closed) throw new Error("Publisher is closed");
      const i = this.order.indexOf(this.selectedId);
      if (i + 1 < this.order.length) {
        this.selectedId = this.order[i + 1];
        return this.get(this.selectedId);
      }
      const id = randomUUID(),
        observation = await this.render(blankSlide, id);
      if (this.closed) throw new Error("Publisher is closed");
      if (historyEpoch !== this.historyEpoch)
        throw new Error("Creation crossed a history boundary");
      this.log.observation(observation);
      this.recordUndo();
      const slide = {
        id,
        title: `Slide ${this.order.length + 1}`,
        observation,
      };
      this.slides.set(id, slide);
      this.order.push(id);
      this.selectedId = id;
      this.revision++;
      this.notifyStructure([id]);
      return slide;
    });
  }
  branch(
    agent: string,
    role: Role,
    observation: Observation,
    speech?: Speech,
  ): Branch {
    return {
      id: randomUUID(),
      historyEpoch: observation.historyEpoch ?? 0,
      agent,
      role,
      source: observation.source,
      slideId: observation.slideId ?? this.selectedId,
      speech: speech && structuredClone(speech),
    };
  }
  private target(branch: Branch) {
    return this.slides.get(branch.slideId ?? this.selectedId);
  }
  private guard(branch: Branch) {
    if (branch.historyEpoch !== this.historyEpoch)
      throw new Error(
        "Edit invalidated by undo/redo; wait for fresh user work",
      );
    if (this.closed) throw new Error("Publisher is closed");
    if (this.paused)
      throw new Error("Agent publication paused; reconsider after resume");
    if (branch.role === "specialist")
      throw new Error("Specialists cannot publish slides");
    if (!this.target(branch))
      throw new Error(
        `Slide ${branch.slideId} was removed; inspect deck and reconsider rather than retargeting`,
      );
  }
  private candidate(
    branch: Branch,
    edit: Edit,
  ): { proposed: string; candidate: string } {
    this.guard(branch);
    const proposed = replaceExactly(branch.source, edit.old, edit.new);
    const current = this.target(branch)!.observation.source;
    let candidate: string;
    try {
      candidate = merge(branch.source, proposed, current);
      const first = current.indexOf(edit.old);
      if (
        candidate !== current &&
        branch.source !== current &&
        first >= 0 &&
        current.indexOf(edit.old, first + 1) >= 0
      )
        throw new Error(
          "The target became ambiguous after concurrent changes. Observe current state before choosing a specific target.",
        );
    } catch (e) {
      const id = `${branch.id}:${this.activeCallId}`;
      if (branch.role === "fast" && !this.forwarded.has(id)) {
        this.forwarded.add(id);
        this.onConflict?.({
          id,
          slideId: branch.slideId,
          edit,
          speech: branch.speech,
          diagnostics: [diagnostic("conflict", errorMessage(e))],
        });
      }
      throw e;
    }
    const access = this.validateAccess?.(branch.role, candidate) ?? [];
    if (access.length) throw new Error(JSON.stringify(access));
    return { proposed, candidate };
  }
  private activeCallId = "";
  edit(branch: Branch, callId: string, edit: Edit): Promise<EditResult> {
    return this.serialize(async () => {
      this.activeCallId = callId;
      const epoch = this.pauseEpoch;
      try {
        const { proposed, candidate } = this.candidate(branch, edit);
        const target = this.target(branch)!;
        if (candidate === target.observation.source) {
          branch.source = proposed;
          return {
            outcome: "unchanged",
            current: target.observation,
            diagnostics: [],
          };
        }
        const next = await this.render(candidate, target.id);
        if (epoch !== this.pauseEpoch)
          throw new Error(
            "Publication crossed a pause boundary; reconsider after resume",
          );
        this.guard(branch); // Pause/close may arrive during render; no frame escapes.
        this.prepare(target, next, branch.role, branch.id, callId);
        this.recordUndo(target.observation);
        this.commit(target, next, branch.role, branch.id, callId);
        branch.source = proposed;
        return {
          outcome: "published",
          current: next,
          diagnostics: next.diagnostics,
        };
      } catch (e) {
        return this.reject([diagnostic("edit", errorMessage(e))], branch);
      }
    });
  }
  private prepare(
    target: SlideRecord,
    next: Observation,
    role: Role,
    inference = "",
    callId = "",
  ) {
    next.fastWatermark = this.fastWatermark + Number(role === "fast");
    this.log.observation(next);
    this.log.write("publication", {
      id: next.id,
      slideId: target.id,
      role,
      inference,
      callId,
    });
  }
  private commit(
    target: SlideRecord,
    next: Observation,
    role: Role,
    _inference = "",
    _callId = "",
    notify = true,
  ) {
    if (role === "fast") {
      this.fastWatermark++;
      this.latestFastSlideId = target.id;
    }
    target.observation = next;
    this.revision++;
    if (notify) this.notifyPublish(next, role);
  }
  private notifyPublish(next: Observation, role: Role) {
    try {
      this.onPublish?.(next, role);
    } catch (e) {
      next.diagnostics = [
        ...next.diagnostics,
        diagnostic("notification", errorMessage(e), "advisory"),
      ];
    }
  }
  /** Atomic compatible edits to several observed slides; one undo unit. */
  editMany(
    edits: { branch: Branch; edit: Edit }[],
    callId: string,
  ): Promise<StructureResult> {
    return this.serialize(async () => {
      this.activeCallId = callId;
      const epoch = this.pauseEpoch;
      try {
        if (
          !edits.length ||
          new Set(edits.map((e) => e.branch.slideId)).size !== edits.length
        )
          throw new Error("Provide one edit per distinct slide");
        if (edits.some((e) => e.branch.role !== "slow"))
          throw new Error("Only Slow may edit across slides");
        const proposals = edits.map((e) => ({
          ...e,
          ...this.candidate(e.branch, e.edit),
        }));
        const changed = proposals.filter(
          (e) => e.candidate !== this.target(e.branch)!.observation.source,
        );
        const rendered: Observation[] = [];
        for (const e of changed)
          rendered.push(await this.render(e.candidate, e.branch.slideId!));
        if (epoch !== this.pauseEpoch)
          throw new Error("Batch crossed a pause boundary");
        for (const e of proposals) this.guard(e.branch);
        for (const [i, e] of changed.entries())
          this.prepare(
            this.target(e.branch)!,
            rendered[i],
            "slow",
            e.branch.id,
            callId,
          );
        if (changed.length) {
          this.recordUndo();
          for (const [i, e] of changed.entries())
            this.commit(
              this.target(e.branch)!,
              rendered[i],
              "slow",
              e.branch.id,
              callId,
              false,
            );
          for (const next of rendered) this.notifyPublish(next, "slow");
        }
        for (const e of proposals) e.branch.source = e.proposed;
        return {
          outcome: "published",
          slideIds: proposals.map((e) => e.branch.slideId!),
          diagnostics: [],
        };
      } catch (e) {
        return {
          outcome: "rejected",
          slideIds: [],
          diagnostics: [diagnostic("batch", errorMessage(e))],
        };
      }
    });
  }
  split(
    branch: Branch,
    parts: { title: string; source: string }[],
    manual = false,
  ): Promise<StructureResult> {
    return this.restructure([branch], parts, "split", manual);
  }
  mergeSlides(
    branches: Branch[],
    merged: { title: string; source: string },
    manual = false,
  ): Promise<StructureResult> {
    return this.restructure(branches, [merged], "merge", manual);
  }
  private restructure(
    branches: Branch[],
    parts: { title: string; source: string }[],
    kind: "split" | "merge",
    manual: boolean,
  ): Promise<StructureResult> {
    return this.serialize(async () => {
      const epoch = this.pauseEpoch;
      try {
        const check = () => {
          if (branches.some((b) => b.historyEpoch !== this.historyEpoch))
            throw new Error("Structure invalidated by undo/redo");
          if (!manual && epoch !== this.pauseEpoch)
            throw new Error("Structure crossed a pause boundary");
          if (this.closed || (!manual && this.paused))
            throw new Error("Structure publication closed or paused");
          if (branches.some((b) => b.role !== "slow"))
            throw new Error(
              "Only Slow or explicit user controls may restructure the deck",
            );
          if (
            branches.some(
              (b) =>
                !this.target(b) ||
                this.target(b)!.observation.source !== b.source,
            )
          )
            throw new Error(
              "Affected slide changed or was removed; inspect again before restructuring",
            );
        };
        check();
        const ids = branches.map((b) => b.slideId!);
        if (new Set(ids).size !== ids.length)
          throw new Error("Duplicate slide IDs");
        if (
          kind === "split"
            ? ids.length !== 1 || parts.length < 2
            : ids.length < 2
        )
          throw new Error(
            "Split needs at least two parts; merge needs at least two slides",
          );
        const index = this.order.indexOf(ids[0]);
        if (ids.some((id, i) => this.order[index + i] !== id))
          throw new Error("Merge inputs must be adjacent in deck order");
        const outputIds = parts.map((_, i) =>
          i === 0 ? ids[0] : randomUUID(),
        );
        const observations: Observation[] = [];
        for (const [i, part] of parts.entries()) {
          const access = this.validateAccess?.("slow", part.source) ?? [];
          if (access.length) throw new Error(JSON.stringify(access));
          observations.push(await this.render(part.source, outputIds[i]));
        }
        check();
        for (const o of observations) this.log.observation(o);
        this.log.write("structure_publication", {
          kind,
          removed: ids.filter((id) => !outputIds.includes(id)),
          slideIds: outputIds,
        });
        this.recordUndo();
        for (const id of ids) this.slides.delete(id);
        this.order.splice(index, ids.length, ...outputIds);
        for (const [i, id] of outputIds.entries()) {
          this.slides.set(id, {
            id,
            title: parts[i].title,
            observation: observations[i],
          });
        }
        if (ids.includes(this.selectedId)) this.selectedId = ids[0];
        this.revision++;
        return this.notifyStructure(outputIds);
      } catch (e) {
        return {
          outcome: "rejected",
          slideIds: [],
          diagnostics: [diagnostic("structure", errorMessage(e))],
        };
      }
    });
  }
  private notifyStructure(slideIds: string[]): StructureResult {
    const result: StructureResult = {
      outcome: "published",
      slideIds,
      diagnostics: [],
    };
    try {
      this.onStructure?.(result);
    } catch (e) {
      result.diagnostics.push(
        diagnostic("notification", errorMessage(e), "advisory"),
      );
    }
    return result;
  }
  private reject(diagnostics: Diagnostic[], branch?: Branch): EditResult {
    const current =
      (branch && this.target(branch)?.observation) || this.current;
    try {
      this.log.write("edit_rejected", {
        diagnostics,
        current: current.id,
        slideId: branch?.slideId,
      });
    } catch {}
    return { outcome: "rejected", current, diagnostics };
  }
  async close() {
    this.closed = true;
    await this.chain;
    await this.renderer.close();
  }
}

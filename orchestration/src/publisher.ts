import { randomUUID } from "node:crypto";
import { merge, replaceExactly } from "./merge.js";
import {
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
  id: string;
  agent: string;
  role: Role;
  source: string;
  speech?: Speech;
}
export interface EditResult {
  outcome: "published" | "unchanged" | "rejected";
  current: Observation;
  diagnostics: Diagnostic[];
}
export class Publisher {
  current!: Observation;
  undo: Observation[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private forwarded = new Set<string>();
  onPublish?: (observation: Observation, role: Role) => void;
  onConflict?: (intent: {
    id: string;
    edit: Edit;
    speech?: Speech;
    diagnostics: Diagnostic[];
  }) => void;
  closed = false;
  validateAccess?: (role: Role, source: string) => Diagnostic[];
  constructor(
    private renderer: Renderer,
    private log: Log = silentLog,
  ) {}
  async initialize(source: string) {
    const result = await this.renderer.render(source);
    if (result.diagnostics.some((d) => d.severity === "error"))
      throw new Error(JSON.stringify(result.diagnostics));
    this.current = { ...result, source, id: randomUUID(), fastWatermark: 0 };
    this.log.observation(this.current);
  }
  branch(
    agent: string,
    role: Role,
    observation: Observation,
    speech?: Speech,
  ): Branch {
    return {
      id: randomUUID(),
      agent,
      role,
      source: observation.source,
      speech: speech && structuredClone(speech),
    };
  }
  edit(branch: Branch, callId: string, edit: Edit): Promise<EditResult> {
    const operation = this.chain.then(async (): Promise<EditResult> => {
      if (this.closed)
        return this.reject([diagnostic("closed", "Publisher is closed.")]);
      if (branch.role === "specialist")
        return this.reject([
          diagnostic("private_only", "Specialists cannot publish slides."),
        ]);
      let proposed: string;
      try {
        proposed = replaceExactly(branch.source, edit.old, edit.new);
      } catch (e) {
        return this.reject([diagnostic("target", errorMessage(e))]);
      }
      let candidate: string;
      try {
        candidate = merge(branch.source, proposed, this.current.source);
        const first = this.current.source.indexOf(edit.old);
        if (
          candidate !== this.current.source &&
          branch.source !== this.current.source &&
          first >= 0 &&
          this.current.source.indexOf(edit.old, first + 1) >= 0
        ) {
          throw new Error(
            "The target became ambiguous after concurrent changes. Observe current state before choosing a specific target.",
          );
        }
      } catch (e) {
        const diagnostics = [diagnostic("conflict", errorMessage(e))];
        const id = `${branch.id}:${callId}`;
        if (branch.role === "fast" && !this.forwarded.has(id)) {
          this.forwarded.add(id);
          this.onConflict?.({ id, edit, speech: branch.speech, diagnostics });
        }
        return this.reject(diagnostics);
      }
      const accessDiagnostics =
        this.validateAccess?.(branch.role, candidate) ?? [];
      if (accessDiagnostics.length) return this.reject(accessDiagnostics);
      if (candidate === this.current.source) {
        branch.source = proposed;
        return { outcome: "unchanged", current: this.current, diagnostics: [] };
      }
      try {
        const rendered = await this.renderer.render(candidate);
        if (rendered.diagnostics.some((d) => d.severity === "error"))
          return this.reject(rendered.diagnostics);
        if (this.closed)
          return this.reject([
            diagnostic(
              "closed",
              "Closed while rendering; candidate discarded.",
            ),
          ]);
        const next: Observation = {
          ...rendered,
          source: candidate,
          id: randomUUID(),
          fastWatermark:
            this.current.fastWatermark + Number(branch.role === "fast"),
        };
        this.log.observation(next);
        this.log.write("publication", {
          id: next.id,
          role: branch.role,
          agent: branch.agent,
          inference: branch.id,
          callId,
        });
        this.undo.push(this.current);
        this.current = next;
        branch.source = proposed; // Never incorporate unseen concurrent changes.
        try {
          this.onPublish?.(next, branch.role);
        } catch (error) {
          // The publication is already committed; a subscriber cannot roll it back.
          return {
            outcome: "published",
            current: next,
            diagnostics: [
              ...rendered.diagnostics,
              diagnostic("notification", errorMessage(error), "advisory"),
            ],
          };
        }
        return {
          outcome: "published",
          current: this.current,
          diagnostics: rendered.diagnostics,
        };
      } catch (e) {
        return this.reject([diagnostic("render", errorMessage(e))]);
      }
    });
    this.chain = operation.catch(() => {});
    return operation;
  }
  private reject(diagnostics: Diagnostic[]): EditResult {
    try {
      this.log.write("edit_rejected", {
        diagnostics,
        current: this.current.id,
      });
    } catch {
      /* Preserve the actionable tool result if logging itself fails. */
    }
    return { outcome: "rejected", current: this.current, diagnostics };
  }
  async close() {
    this.closed = true;
    await this.chain;
    await this.renderer.close();
  }
}

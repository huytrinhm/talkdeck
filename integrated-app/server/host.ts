import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createPracticeRuntime } from "../../slide-generation/src/practice/runtime.js";
import { GenerationSession } from "../../slide-generation/src/host/session.js";
import { createViewerDocument } from "../../slide-generation/src/viewer/document.js";
import { atomicWrite } from "../../slide-generation/src/storage/files.js";
import {
  nodes,
  parseSource,
  textContent,
} from "../../slide-generation/src/parser.js";
import { expandSource } from "../../slide-generation/src/expansion.js";
import { readIcon } from "../../slide-generation/src/render/icons.js";
import { childNodes } from "../../slide-generation/src/schema.js";
import { escapeText } from "../../slide-generation/src/source/surgery.js";
import {
  navigationCommand,
  namedInputTarget,
} from "../../slide-generation/src/headless/input-routing.js";
import { LiveTranscription } from "../../slide-generation/src/orchestration/transcription.js";
import { models } from "../../slide-generation/src/orchestration/config.js";
import { ProductProviders, safeError } from "./providers.js";
import type {
  Command,
  Material,
  Mode,
  Project,
  Receipt,
  ServerEvent,
  Session,
  Snapshot,
  Transcript,
  Utterance,
} from "../shared/protocol.js";
import type { IncomingMessage } from "../../slide-generation/src/viewer/protocol.js";

type Runtime = Awaited<ReturnType<typeof createPracticeRuntime>>;
export type RuntimeFactory = (
  options: Parameters<typeof createPracticeRuntime>[0],
) => Promise<Runtime>;
export class ProductError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface Persisted {
  project: Project;
  mode: Mode;
  epoch: number;
  selectedId?: string;
  build: number;
  blackout: boolean;
  practiceId?: string;
  modeStartedAtMs: number;
  transcripts: Transcript[];
  materials: Material[];
  commands: Record<
    string,
    { fingerprint: string; result?: unknown; pending?: boolean }
  >;
  inputs: Record<
    string,
    {
      fingerprint: string;
      receipt?: Receipt;
      error?: string;
      pending?: boolean;
    }
  >;
}
interface Attachment {
  dto: Session;
  publication: GenerationSession;
  latest?: IncomingMessage;
  events: ServerEvent[];
  listeners: Set<(event: ServerEvent) => void>;
  nextEvent: number;
}

export class ProjectOwner {
  runtime!: Runtime;
  providers!: ProductProviders;
  readonly sessions = new Map<string, Attachment>();
  private tail: Promise<unknown> = Promise.resolve();
  private saveTail: Promise<unknown> = Promise.resolve();
  private imageCache = new Map<string, Promise<Uint8Array>>();
  private live = new Map<
    string,
    { transcriber: LiveTranscription; finals: string[] }
  >();
  private unsubscribe: (() => void)[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private error?: string;
  private closed = false;
  constructor(
    readonly directory: string,
    readonly data: Persisted,
    private factory: RuntimeFactory,
  ) {}
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    this.providers = new ProductProviders(
      join(this.directory, "providers.jsonl"),
      () => this.broadcastSnapshot(),
    );
    this.runtime = await this.factory({
      directory: join(this.directory, "runtime"),
      storageRoot: resolve(this.directory, "..", ".."),
      client: this.providers.client,
      context: this.data.project.context,
      onSelection: async (id) => {
        this.data.selectedId = id;
        this.data.build = 0;
        await this.syncSurfaces();
        await this.save();
        this.broadcastSnapshot();
      },
      log: {
        write: (type, data) => {
          this.providers.record({ type, at: Date.now(), ...data });
          if (type.includes("error") || type.includes("fail")) {
            this.error = safeError(data.error ?? data.message ?? type);
            this.broadcastSnapshot();
          }
        },
        observation() {},
      },
    });
    const generationInstructions = this.runtime.backend.generation.instructions;
    this.runtime.backend.generation.instructions = (role) =>
      generationInstructions(role) +
      "\n\nCurrent canonical project context:\n" +
      textContent(
        childNodes(
          parseSource(this.runtime.local.engine.readDocument().source),
        ).find((n) => n.tag === "Brief")!,
      );
    if (
      this.data.selectedId &&
      this.runtime.backend.list().some((s) => s.id === this.data.selectedId)
    )
      await this.runtime.backend.navigate(this.data.selectedId);
    this.data.selectedId = this.runtime.backend.selectedId;
    this.data.epoch++;
    if (this.data.mode === "practice") this.data.mode = "review";
    if (this.data.mode !== "talk") {
      await this.runtime.actors.setPracticeMode(true);
      this.runtime.actors.pause();
    }
    for (const input of Object.values(this.data.inputs))
      if (input.pending) {
        input.pending = false;
        input.error =
          "Input interrupted. Retained bytes are available; automatic paid retry is disabled.";
      }
    this.unsubscribe.push(
      this.runtime.local.engine.subscribe(() => {
        this.data.project.updatedAt = new Date().toISOString();
        void this.save();
        this.broadcastSnapshot();
      }),
    );
    this.unsubscribe.push(
      this.runtime.actors.subscribe(() => this.broadcastSnapshot()),
    );
    this.timer = setInterval(() => this.broadcastSnapshot(), 1500);
    this.timer.unref();
    if (this.contextText()) await this.updateBrief(this.contextText());
    await this.save();
  }
  private serialize<T>(fn: () => Promise<T>) {
    const run = this.tail.then(fn);
    this.tail = run.catch(() => {});
    return run;
  }
  save() {
    const body = JSON.stringify(this.data);
    const run = this.saveTail
      .catch(() => {})
      .then(() => atomicWrite(join(this.directory, "project.json"), body));
    this.saveTail = run;
    return run;
  }
  snapshot(): Snapshot {
    const { local, backend, actors, practice } = this.runtime;
    return {
      protocol: 1,
      project: { ...this.data.project },
      revision: local.engine.state().revision,
      mode: this.data.mode,
      epoch: this.data.epoch,
      selectedId: backend.selectedId,
      slides: backend
        .list()
        .map((s) => ({
          id: s.id,
          title: s.title,
          notes: local.engine.readSpeakerNotes(s.id).notes,
          thumbnail: `/api/projects/${this.data.project.id}/slides/${s.id}/image?revision=${local.engine.state().revision}`,
        })),
      transcripts: this.data.transcripts.filter(
        (t) =>
          !["present", "practice"].includes(this.data.mode) ||
          t.epoch === this.data.epoch,
      ),
      materials: this.data.materials,
      practiceId: this.data.practiceId,
      history: backend.historyStatus(),
      actors: actors
        .statuses()
        .map((s) => ({
          ...s,
          error: s.error ? safeError(s.error) : undefined,
        })),
      build: this.data.build,
      blackout: this.data.blackout,
      generationPaused: actors.paused,
      reviewList: practice
        .list()
        .map((r: any) => ({
          id: r.id,
          status: r.status,
          startedAt: r.startedAt,
          error: r.error,
        })),
      usage: this.providers.snapshot(),
      serverTimeMs: Date.now(),
      modeStartedAtMs: this.data.modeStartedAtMs,
      error: this.error,
    };
  }
  broadcastSnapshot() {
    if (!this.runtime || this.closed) return;
    for (const a of this.sessions.values())
      if (a.dto.role === "editor") this.event(a, "snapshot", this.snapshot());
  }
  private event(a: Attachment, type: ServerEvent["type"], data: unknown) {
    const e = { id: ++a.nextEvent, type, data };
    a.events.push(e);
    if (a.events.length > 256) a.events.shift();
    for (const listener of a.listeners) listener(e);
  }
  async attach(role: "editor" | "audience") {
    if (role === "audience" && this.data.mode !== "present")
      throw new ProductError(
        "presentation_required",
        "Enter Present before opening the audience view",
      );
    const dto: Session = {
      id: randomUUID(),
      token: randomBytes(32).toString("base64url"),
      projectId: this.data.project.id,
      role,
      channel: randomBytes(24).toString("base64url"),
      viewerDocument: "",
      serverTimeMs: Date.now(),
      serverMonotonicMs: performance.now(),
    };
    dto.viewerDocument = createViewerDocument(dto.channel);
    const a: Attachment = {
      dto,
      publication: null!,
      events: [],
      listeners: new Set(),
      nextEvent: 0,
    };
    a.publication = new GenerationSession(
      this.runtime.local.engine,
      this.runtime.local.tools,
      this.runtime.local.renderer,
      this.runtime.local.browser,
      {
        channel: dto.channel,
        slideId: this.runtime.backend.selectedId,
        mode:
          role === "audience" || this.data.mode === "present"
            ? "presentation"
            : "editor",
        send: (message) => {
          a.latest = message;
          this.event(a, "viewer", message);
        },
        sendBuild: (message) => {
          if (a.latest?.type === "publish")
            a.latest = {
              ...a.latest,
              sequence: message.sequence,
              build: message.build,
              holdIds: message.holdIds,
            };
          this.event(a, "viewer", message);
        },
        record: (event) => {
          if (event.type === "publication-refused") {
            this.error = event.code;
            if (role === "editor")
              this.event(a, "error", {
                code: event.code,
                message: "The validated viewer kept its last slide.",
              });
          }
          this.providers.record({
            kind: "viewer",
            sessionId: dto.id,
            ...event,
          });
        },
      },
    );
    this.sessions.set(dto.id, a);
    await a.publication.selectSlide(
      this.runtime.backend.selectedId,
      role === "audience" || this.data.mode === "present"
        ? "presentation"
        : "editor",
      this.data.build,
    );
    if (role === "editor") dto.snapshot = this.snapshot();
    dto.serverTimeMs = Date.now();
    dto.serverMonotonicMs = performance.now();
    return dto;
  }
  authorize(id: string | undefined, token: string | undefined, editor = false) {
    const a = id ? this.sessions.get(id) : undefined;
    if (!a || !token || a.dto.token !== token)
      throw new ProductError(
        "session_expired",
        "Reattach to this project before continuing",
        401,
      );
    if (editor && a.dto.role !== "editor")
      throw new ProductError(
        "audience_private",
        "Audience attachments cannot access private project data",
        403,
      );
    return a;
  }
  async detach(a: Attachment) {
    this.sessions.delete(a.dto.id);
    this.live.get(a.dto.id)?.transcriber.close();
    this.live.delete(a.dto.id);
    a.listeners.clear();
    await a.publication.close();
  }
  subscribe(
    a: Attachment,
    last: number | undefined,
    listener: (event: ServerEvent) => void,
  ) {
    a.listeners.add(listener);
    if (
      last !== undefined &&
      Number.isSafeInteger(last) &&
      last >= 0 &&
      last <= a.nextEvent &&
      a.events.length &&
      last >= a.events[0].id - 1
    )
      for (const e of a.events)
        if (e.id > last) listener(e);
        else {
        }
    else this.event(a, "resync", { serverTimeMs: Date.now() });
    return () => a.listeners.delete(listener);
  }
  bootstrap(a: Attachment) {
    return {
      channel: a.dto.channel,
      viewerDocument: a.dto.viewerDocument,
      message: a.latest,
      blackout: this.data.blackout,
      serverTimeMs: Date.now(),
      serverMonotonicMs: performance.now(),
    };
  }
  async syncSurfaces() {
    await Promise.all(
      [...this.sessions.values()].map(async (a) => {
        if (a.dto.role === "audience" && this.data.mode !== "present") return;
        await a.publication.selectSlide(
          this.runtime.backend.selectedId,
          a.dto.role === "audience" || this.data.mode === "present"
            ? "presentation"
            : "editor",
          this.data.build,
        );
      }),
    );
  }
  private checkEpoch(epoch: number) {
    if (epoch !== this.data.epoch)
      throw new ProductError(
        "stale_epoch",
        "The mode changed. Reconnect before sending more input.",
      );
  }
  private contextText(context = this.data.project.context) {
    return [
      context,
      ...this.data.materials
        .filter((m) => m.text)
        .map((m) => `Source material ${m.name} (${m.id}):\n${m.text}`),
    ].join("\n\n");
  }
  private async updateBrief(context: string) {
    const root = parseSource(this.runtime.local.engine.readDocument().source);
    const brief = childNodes(root).find((n) => n.tag === "Brief")!;
    if (textContent(brief) === context) return;
    const read = this.runtime.local.engine.readSource(brief.id!);
    const result = await this.runtime.local.engine.edit({
      edits: [
        {
          snapshotId: read.snapshotId,
          nodeId: read.nodeId,
          op: "replace",
          startLine: 1,
          hashes: read.lines.map((l) => l.hash),
          text: `<Brief id="${brief.id}">${escapeText(context)}</Brief>`,
        },
      ],
    });
    if (!result.accepted)
      throw new ProductError(
        "context_refused",
        "Project context could not be stored in canonical source",
      );
  }
  async command(command: Command) {
    return this.serialize(async () => {
      const fingerprint = digest(command),
        previous = this.data.commands[command.id];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ProductError(
            "command_conflict",
            "Command ID reused with different content",
          );
        if (previous.pending)
          throw new ProductError(
            "command_interrupted",
            "Command interrupted; reload canonical state before making a new command",
          );
        return { snapshot: this.snapshot(), result: previous.result };
      }
      this.checkEpoch(command.epoch);
      this.data.commands[command.id] = { fingerprint, pending: true };
      await this.save();
      let result: unknown;
      try {
        if (command.type === "mode")
          result = await this.mode(command.mode!, command.input ?? "audio");
        else if (command.type === "select") {
          await this.runtime.actors.selectSlide(command.slideId!);
          this.data.build = 0;
        } else if (command.type === "next" || command.type === "previous")
          await this.navigate(command.type === "next" ? 1 : -1);
        else if (command.type === "add") {
          if (!["talk", "view"].includes(this.data.mode))
            throw new ProductError(
              "mode",
              "Slides can be added in View or Talk",
            );
          await this.runtime.backend.createSlide();
        } else if (command.type === "undo" || command.type === "redo") {
          if (this.data.mode === "present")
            throw new ProductError(
              "presentation_frozen",
              "Return to Talk or Review to edit",
            );
          result = await this.runtime.actors[command.type]();
        } else if (command.type === "pause") this.runtime.actors.pause();
        else if (command.type === "resume") {
          if (this.data.mode !== "talk" && this.data.mode !== "practice")
            throw new ProductError(
              "mode",
              "Generation can resume only in Talk or explicit practice editing",
            );
          this.runtime.actors.resume();
        } else if (command.type === "blackout") {
          this.data.blackout =
            typeof command.value === "boolean"
              ? command.value
              : !this.data.blackout;
          for (const a of this.sessions.values())
            this.event(a, "blackout", { blackout: this.data.blackout });
        } else if (command.type === "build")
          await this.setBuild(Number(command.value));
        else if (command.type === "context") {
          if (this.data.mode === "present")
            throw new ProductError(
              "presentation_frozen",
              "Return to Talk to edit context",
            );
          await this.updateBrief(this.contextText(command.context ?? ""));
          this.data.project.context = command.context ?? "";
        } else if (command.type === "push-to-edit") {
          if (this.data.mode === "present")
            throw new ProductError(
              "presentation_frozen",
              "Return to Talk to edit",
            );
          result = this.runtime.actors.pushToEdit(
            command.prompt!,
            command.slideId ?? this.runtime.backend.selectedId,
          );
        }
        this.data.commands[command.id] = { fingerprint, result };
        this.data.project.updatedAt = new Date().toISOString();
        await this.save();
        this.broadcastSnapshot();
        return { snapshot: this.snapshot(), result };
      } catch (error) {
        this.data.commands[command.id] = { fingerprint, pending: true };
        this.error = safeError(error);
        await this.save();
        this.broadcastSnapshot();
        throw error;
      }
    });
  }
  private async mode(mode: Mode, input: "audio" | "transcript") {
    if (!["view", "talk", "present", "practice", "review"].includes(mode))
      throw new ProductError("mode", "Unknown mode");
    if (mode === this.data.mode) return;
    if (
      this.data.mode === "practice" &&
      this.data.practiceId &&
      this.runtime.practice.get(this.data.practiceId).status === "recording"
    )
      throw new ProductError(
        "recording_open",
        "Finish or cancel practice before changing mode",
      );
    for (const live of this.live.values()) live.transcriber.close();
    this.live.clear();
    const priorMode = this.data.mode,
      priorPractice = this.runtime.actors.practiceMode,
      priorPaused = this.runtime.actors.paused;
    let practiceStart: number | undefined;
    try {
      if (mode === "practice") {
        this.runtime.actors.resume();
        const record = await this.runtime.practice.start(
          { context: this.data.project.context },
          input,
        );
        this.data.practiceId = record.id;
        practiceStart = Date.parse(record.startedAt);
      } else if (mode === "talk") {
        await this.runtime.practice.leavePractice();
        this.runtime.actors.resume();
      } else {
        await this.runtime.actors.setPracticeMode(true);
        this.runtime.actors.pause();
        if (mode === "present") {
          const readiness = await this.runtime.local.engine.readiness();
          if (!readiness.ready)
            throw new ProductError(
              "presentation_blocked",
              JSON.stringify(readiness.findings),
            );
        }
      }
    } catch (error) {
      await this.runtime.actors.setPracticeMode(priorPractice);
      if (priorPaused) this.runtime.actors.pause();
      else this.runtime.actors.resume();
      throw error;
    }
    if (priorMode === "present")
      for (const a of [...this.sessions.values()])
        if (a.dto.role === "audience") {
          this.event(a, "blackout", { blackout: true });
          this.event(a, "error", {
            code: "presentation_ended",
            message:
              "Presentation ended. Reopen the audience view for the next presentation.",
          });
          await this.detach(a);
        }
    this.data.mode = mode;
    this.data.epoch++;
    this.data.modeStartedAtMs = practiceStart ?? Date.now();
    this.data.build = 0;
    this.data.blackout = false;
    this.error = undefined;
    await this.syncSurfaces();
  }
  private builds() {
    const slide = expandSource(
      this.runtime.local.engine.readDocument().source,
      { resolveIcon: readIcon },
    ).slides.find((n) => n.id === this.runtime.backend.selectedId)!;
    const groups: number[] = [0];
    const visit = (n: any) => {
      groups.push(Number(n.props?.build ?? 0));
      for (const child of n.children ?? [])
        if (typeof child !== "string") visit(child);
    };
    visit(slide);
    return [...new Set(groups)].sort((a, b) => a - b);
  }
  private async setBuild(value: number) {
    if (!Number.isInteger(value) || value < 0)
      throw new ProductError("build", "Build must be a nonnegative integer");
    this.data.build = value;
    await Promise.all(
      [...this.sessions.values()].map((a) => a.publication.setBuild(value)),
    );
  }
  private async navigate(direction: number) {
    const slides = this.runtime.backend.list(),
      index = slides.findIndex((s) => s.id === this.runtime.backend.selectedId);
    if (this.data.mode === "present") {
      const groups = this.builds();
      const build =
        direction > 0
          ? groups.find((n) => n > this.data.build)
          : groups.filter((n) => n < this.data.build).at(-1);
      if (build !== undefined) {
        await this.setBuild(build);
        return;
      }
    }
    const next = slides[index + direction];
    if (next) await this.runtime.actors.selectSlide(next.id);
  }
  async input(input: Utterance): Promise<Receipt> {
    return this.serialize(() => this.retainInput(input));
  }
  private async retainInput(input: Utterance): Promise<Receipt> {
    const fingerprint = digest(input),
      prior = this.data.inputs[input.id];
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new ProductError(
          "input_conflict",
          "Input ID reused with different content",
        );
      if (prior.receipt) return { ...prior.receipt, duplicate: true };
      throw new ProductError(
        "input_incomplete",
        prior.error ?? "Input is already processing",
      );
    }
    this.checkEpoch(input.epoch);
    if (!["talk", "practice", "present"].includes(this.data.mode))
      throw new ProductError("mode", "Enter a voice mode before sending input");
    this.runtime.backend.get(input.slideId);
    this.data.inputs[input.id] = { fingerprint, pending: true };
    await this.save();
    try {
      let slideId = input.slideId;
      if (this.data.mode === "talk") {
        const command = navigationCommand(input.text);
        if (command?.type === "new") {
          const empty =
            this.runtime.backend.list().length === 1 &&
            ![
              ...nodes(
                parseSource(this.runtime.local.engine.readDocument().source),
              ),
            ].some((n) => n.tag === "Prompt");
          if (!empty) {
            const slide = await this.runtime.backend.createSlide(command.title);
            slideId = slide.id;
          } else
            this.runtime.backend.requestedTitles.set(slideId, command.title);
        } else if (command?.type === "select") {
          const matches = this.runtime.backend
            .list()
            .filter(
              (s) => s.title.toLowerCase() === command.title.toLowerCase(),
            );
          if (matches.length !== 1)
            throw new ProductError("navigation", "Named slide was not unique");
          slideId = matches[0].id;
          await this.runtime.actors.selectSlide(slideId);
        } else
          slideId =
            namedInputTarget(input.text, this.runtime.backend.list()) ??
            slideId;
        await this.runtime.actors.deliverUtterance({
          id: input.id,
          slideId,
          text: input.text,
          deliveredAtMs: input.endMs,
          correctionOf: input.correctionOf,
        });
      } else if (this.data.mode === "practice") {
        if (!this.data.practiceId)
          throw new ProductError("practice", "No recording");
        await this.runtime.practice.addSpeech(this.data.practiceId, {
          id: input.id,
          slideId,
          text: input.text,
          startMs: input.startMs,
          endMs: input.endMs,
          timing: "receipt",
          correctionOf: input.correctionOf,
        });
      } else if (/^(next( slide)?|go forward)[.!]?$/i.test(input.text.trim()))
        await this.navigate(1);
      else if (
        /^(back|previous( slide)?|go back)[.!]?$/i.test(input.text.trim())
      )
        await this.navigate(-1);
      this.data.transcripts.push({
        id: input.id,
        text: input.text,
        slideId,
        mode: this.data.mode,
        epoch: this.data.epoch,
        atMs: input.endMs,
        correctionOf: input.correctionOf,
      });
      const receipt: Receipt = {
        id: input.id,
        retained: true,
        duplicate: false,
        mode: this.data.mode,
        epoch: this.data.epoch,
        slideId,
        text: input.text,
      };
      this.data.inputs[input.id] = { fingerprint, receipt };
      await this.save();
      this.broadcastSnapshot();
      return receipt;
    } catch (error) {
      this.data.inputs[input.id] = { fingerprint, error: safeError(error) };
      await this.save();
      throw error;
    }
  }
  async audio(
    a: Attachment,
    input: Omit<Utterance, "text"> & { sequence: number },
    pcm: Buffer,
  ): Promise<Receipt> {
    return this.serialize(async () => {
      const fingerprint = digest({
          ...input,
          pcm: createHash("sha256").update(pcm).digest("hex"),
        }),
        prior = this.data.inputs[input.id];
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new ProductError(
            "input_conflict",
            "Audio ID reused with different bytes",
          );
        if (prior.receipt) return { ...prior.receipt, duplicate: true };
        throw new ProductError(
          "input_incomplete",
          prior.error ?? "Audio is already processing",
        );
      }
      this.checkEpoch(input.epoch);
      if (!["talk", "practice", "present"].includes(this.data.mode))
        throw new ProductError("mode", "Voice mode is not active");
      if (!pcm.length || pcm.length % 2 || pcm.length > 48_000 * 30)
        throw new ProductError(
          "audio",
          "Expected at most30 seconds of mono24k PCM16",
        );
      this.runtime.backend.get(input.slideId);
      await mkdir(join(this.directory, "audio"), { recursive: true });
      await writeFile(
        join(this.directory, "audio", `${digest(input.id)}.pcm`),
        pcm,
        { mode: 0o600 },
      );
      this.data.inputs[input.id] = { fingerprint, pending: true };
      await this.save();
      try {
        let text: string | undefined;
        if (this.data.mode === "practice")
          await this.runtime.practice.addAudio(
            this.data.practiceId!,
            input.sequence,
            input.startMs,
            pcm,
          );
        else {
          let live = this.live.get(a.dto.id);
          if (!live) {
            const finals: string[] = [];
            const transcriber = new LiveTranscription(
              this.providers.client,
              models().transcription,
              () => {},
              {
                write: (type, data) => {
                  this.providers.record({ type, ...data });
                  const event = data.event as any;
                  if (
                    event?.type ===
                    "conversation.item.input_audio_transcription.completed"
                  )
                    finals.push(event.transcript ?? "");
                },
                observation() {},
              },
              { maxConnectionAttempts: 1 },
            );
            live = { transcriber, finals };
            this.live.set(a.dto.id, live);
            await transcriber.connect();
          }
          const reservation = this.providers.reserveTranscription();
          let failure: unknown;
          try {
            live.finals.length = 0;
            live.transcriber.append(pcm);
            await live.transcriber.commit();
            text = live.finals.join(" ").trim();
          } catch (error) {
            failure = error;
            live.transcriber.close();
            this.live.delete(a.dto.id);
            throw error;
          } finally {
            this.providers.finishTranscription(reservation, failure);
          }
          if (text) {
            delete this.data.inputs[input.id];
            const typed = await this.retainInput({ ...input, text });
            this.data.inputs[input.id] = { fingerprint, receipt: typed };
            await this.save();
            return typed;
          }
        }
        const receipt: Receipt = {
          id: input.id,
          retained: true,
          duplicate: false,
          mode: this.data.mode,
          epoch: this.data.epoch,
          slideId: input.slideId,
          text,
        };
        this.data.inputs[input.id] = { fingerprint, receipt };
        await this.save();
        this.broadcastSnapshot();
        return receipt;
      } catch (error) {
        this.providers.record({
          type: "audio_failed",
          id: input.id,
          error: safeError(error),
        });
        this.data.inputs[input.id] = { fingerprint, error: safeError(error) };
        this.error = safeError(error);
        await this.save();
        this.broadcastSnapshot();
        throw error;
      }
    });
  }
  async practiceCall(
    path: string,
    method: string,
    body?: unknown,
    headers?: Headers,
  ) {
    return this.serialize(async () => {
      if (
        this.data.mode === "present" &&
        /\/accept$/.test(path) &&
        method === "POST"
      )
        throw new ProductError(
          "presentation_frozen",
          "Return to Review to accept changes",
        );
      const activePractice =
        path.split("/")[2] === this.data.practiceId &&
        this.data.mode === "practice";
      const url = `http://practice${path}`;
      const request = new Request(url, {
        method,
        headers: headers ?? { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const response = await this.runtime.app.fetch(request);
      const data = await response.json();
      if (response.ok && activePractice && /\/(finish|cancel)$/.test(path)) {
        this.data.mode = "review";
        this.data.epoch++;
        this.runtime.actors.pause();
        this.data.modeStartedAtMs = Date.now();
        await this.save();
      }
      this.broadcastSnapshot();
      return { status: response.status, data };
    });
  }
  async material(file: File): Promise<Material> {
    return this.serialize(async () => {
      if (this.data.mode === "present")
        throw new ProductError(
          "presentation_frozen",
          "Return to Talk to upload context",
        );
      const id = randomUUID();
      const bytes = Buffer.from(await file.arrayBuffer());
      await mkdir(join(this.directory, "materials"), { recursive: true });
      await writeFile(join(this.directory, "materials", id), bytes, {
        mode: 0o600,
      });
      const supported =
        /\.(txt|md|csv|json)$/i.test(file.name) ||
        file.type.startsWith("text/");
      const material: Material = {
        id,
        name: file.name,
        bytes: bytes.length,
        mime: file.type,
        status: supported ? "extracted" : "reference-only",
        ...(supported ? { text: bytes.toString("utf8") } : {}),
      };
      if (material.text && material.text.length > 100000)
        throw new ProductError(
          "material_large",
          "Text context exceeds100000 characters; bytes remain retained",
        );
      this.data.materials.push(material);
      await this.updateBrief(this.contextText());
      await this.save();
      this.broadcastSnapshot();
      return material;
    });
  }
  async image(slideId: string, revision?: string) {
    const source = this.runtime.local.engine.readDocument().source;
    const current = this.runtime.local.engine.state().revision;
    if (revision && revision !== current)
      throw new ProductError(
        "revision_changed",
        "Reload the latest slide thumbnail",
      );
    const key = `${current}:${slideId}`;
    let pending = this.imageCache.get(key);
    if (!pending) {
      pending = this.runtime.local.browser
        .screenshot(source, [slideId])
        .then((frames) => frames[0].jpeg);
      this.imageCache.set(key, pending);
      while (this.imageCache.size > 40)
        this.imageCache.delete(this.imageCache.keys().next().value!);
    }
    return pending;
  }
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const unsub of this.unsubscribe) unsub();
    for (const live of this.live.values()) live.transcriber.close();
    await this.tail;
    await Promise.all(
      [...this.sessions.values()].map((a) => a.publication.close()),
    );
    await this.runtime.close();
    await this.saveTail;
    await this.providers.close();
  }
}
export class ProjectStore {
  private owners = new Map<string, Promise<ProjectOwner>>();
  constructor(
    readonly directory: string,
    private factory: RuntimeFactory = createPracticeRuntime,
  ) {}
  async list(): Promise<Project[]> {
    await mkdir(this.directory, { recursive: true });
    const result: Project[] = [];
    for (const id of await readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      const data = JSON.parse(
        await readFile(join(this.directory, id, "project.json"), "utf8"),
      ) as Persisted;
      result.push(data.project);
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async create(name: string, context = "") {
    const id = randomUUID(),
      now = new Date().toISOString();
    const project: Project = {
      id,
      schema: "talkdeck-canonical-v1",
      name,
      context,
      createdAt: now,
      updatedAt: now,
    };
    const data: Persisted = {
      project,
      mode: "view",
      epoch: 0,
      build: 0,
      blackout: false,
      modeStartedAtMs: Date.now(),
      transcripts: [],
      materials: [],
      commands: {},
      inputs: {},
    };
    await atomicWrite(
      join(this.directory, id, "project.json"),
      JSON.stringify(data),
    );
    await this.open(id);
    return project;
  }
  open(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new ProductError("project", "Invalid project ID", 404);
    let pending = this.owners.get(id);
    if (!pending) {
      pending = (async () => {
        let data: Persisted;
        try {
          data = JSON.parse(
            await readFile(join(this.directory, id, "project.json"), "utf8"),
          );
        } catch {
          throw new ProductError("project", "Project not found", 404);
        }
        const owner = new ProjectOwner(
          join(this.directory, id),
          data,
          this.factory,
        );
        await owner.initialize();
        return owner;
      })();
      this.owners.set(id, pending);
      pending.catch(() => this.owners.delete(id));
    }
    return pending;
  }
  async close() {
    await Promise.all(
      [...this.owners.values()].map(async (pending) => (await pending).close()),
    );
    this.owners.clear();
  }
}

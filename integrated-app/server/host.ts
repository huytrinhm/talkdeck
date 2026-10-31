import { TranscriptPreview } from './transcript-preview.js';
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
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
import { ready } from "../../slide-generation/src/validation.js";
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
import { serverNavigationTrace } from './tracing.js';
import { ProjectImages } from './images.js';
import { installAssetCatalog } from './asset-tools.js';
import { resolveImage } from '../../slide-generation/src/render/assets.js';
import type {
  Command,
  NavigationDeck,
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
      audio?: AudioPacket;
    }
  >;
}
type AudioPacket = Omit<Utterance, "text"> & { sequence: number; utteranceId?: string; final?: boolean };
interface AudioTurn { input: AudioPacket; mode: Mode; reservation: ReturnType<ProductProviders["reserveTranscription"]>; correctionOf?: string; revision: number; lastPreviewAt: number; lastPreviewText?: string; previewTimer?: ReturnType<typeof setTimeout>; finalized?: boolean; settled?: boolean; }
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
  private queuedAudioBytes = 0;
  private audioTail: Promise<void> = Promise.resolve();
  private saveTail: Promise<unknown> = Promise.resolve();
  private imageCache = new Map<string, Promise<Uint8Array>>();
  private live = new Map<
    string,
    { transcriber: LiveTranscription; finals: string[]; pending?: TranscriptPreview; turn?: AudioTurn }
  >();
  private unsubscribe: (() => void)[] = [];
  private commandTrace?: ReturnType<typeof serverNavigationTrace>;
  private images!: ProjectImages;
  private timer?: ReturnType<typeof setInterval>;
  private error?: string;
  private closed = false;
  private captureOwner?: string;
  constructor(
    readonly directory: string,
    readonly data: Persisted,
    private factory: RuntimeFactory,
  ) {}
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    this.images = new ProjectImages(join(this.directory, 'materials'), this.data.project.id, () => this.data.materials);
    await this.images.restore();
    this.providers = new ProductProviders(
      join(this.directory, "providers.jsonl"),
      () => this.broadcastSnapshot(),
    );
    this.runtime = await this.factory({
      directory: join(this.directory, "runtime"),
      storageRoot: resolve(this.directory, "..", ".."),
      assets: this.images,
      client: this.providers.client,
      context: this.data.project.context,
      onSelection: async (id) => {
        this.commandTrace?.('selection-callback', { slideId: id });
        this.data.selectedId = id;
        this.data.build = 0;
        await this.syncSurfaces();
        this.commandTrace?.('surfaces-synced');
        await this.save();
        this.commandTrace?.('selection-saved');
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
    installAssetCatalog(this.runtime.backend.generation, this.images, event => this.providers.record(event));
    if (
      this.data.selectedId &&
      this.runtime.backend.list().some((s) => s.id === this.data.selectedId)
    )
      await this.runtime.backend.navigate(this.data.selectedId);
    this.data.selectedId = this.runtime.backend.selectedId;
    this.data.epoch++;
    this.data.mode = "talk";
    this.data.build = 0;
    this.data.blackout = false;
    delete this.data.practiceId;
    this.data.modeStartedAtMs = Date.now();
    await this.runtime.actors.setPracticeMode(true);
    this.runtime.actors.pause();
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
    await this.runtime.practice.leavePractice();
    this.runtime.actors.resume();
    await this.save();
  }
  private serialize<T>(fn: () => Promise<T>) {
    const run = this.tail.then(() => {
      if (this.closed) throw new ProductError('project_closed', 'This project is closed', 410);
      return fn();
    });
    this.tail = run.catch(() => {});
    return run;
  }
  save() {
    const { mode, modeStartedAtMs, practiceId, build, blackout, ...saved } = this.data;
    const body = JSON.stringify(saved);
    const run = this.saveTail
      .catch(() => {})
      .then(() => atomicWrite(join(this.directory, "project.json"), body));
    this.saveTail = run;
    return run;
  }
  snapshot(): Snapshot {
    const { local, backend, actors } = this.runtime;
    return {
      protocol: 1,
      project: { ...this.data.project },
      revision: local.engine.state().revision,
      mode: this.data.mode,
      epoch: this.data.epoch,
      selectedId: backend.selectedId,
      slides: backend.list().map((s) => ({
        id: s.id,
        title: s.title,
        notes: local.engine.readSpeakerNotes(s.id).notes,
        thumbnail: `/api/projects/${this.data.project.id}/slides/${s.id}/image?revision=${local.engine.state().revision}`,
      })),
      transcripts: this.data.transcripts.filter((t) => t.epoch === this.data.epoch),
      pendingTranscripts: [...this.live.values()].flatMap(live => live.pending &&
        live.pending.epoch === this.data.epoch && !this.data.transcripts.some(t => t.id === live.pending!.id)
        ? [live.pending.snapshot()] : []),
      materials: this.data.materials,
      practiceId: this.data.practiceId,
      actors: actors.statuses().map((s) => ({
        ...s,
        error: s.error ? safeError(s.error) : undefined,
      })),
      build: this.data.build,
      blackout: this.data.blackout,
      generationPaused: actors.paused,
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
    if (this.closed) throw new ProductError('project_closed', 'This project is closed', 410);
    // Every newly opened editor starts in Talk; modes are session state only.
    if (role === "editor") await this.serialize(async () => {
      if (this.data.practiceId && this.runtime.practice.get(this.data.practiceId).status === "recording")
        await this.runtime.practice.cancel(this.data.practiceId);
      await this.mode("talk", "audio");
      delete this.data.practiceId;
      this.data.build = 0;
      this.data.blackout = false;
      await this.save();
      this.broadcastSnapshot();
    });
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
    if (role === "editor") this.captureOwner = dto.id;
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
    if (this.closed) throw new ProductError('project_closed', 'This project is closed', 410);
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
  authorizeCapture(a: Attachment) {
    if (a.dto.role !== "editor" || this.captureOwner !== a.dto.id)
      throw new ProductError(
        "session_superseded",
        "A newer editor attachment owns microphone input. Reconnect this editor to resume.",
      );
  }
  async detach(a: Attachment) {
    this.sessions.delete(a.dto.id);
    const live = this.live.get(a.dto.id);
    if (live?.turn) this.finishAudioTurn(live.turn, new Error("Capture disconnected before utterance completion; PCM retained"));
    live?.transcriber.close();
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
    this.commandTrace?.('surfaces-start', { attachments: this.sessions.size });
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
      ...this.data.materials.filter(m => m.asset).map(m =>
        `Uploaded image ${JSON.stringify(m.name)} (${m.mime}). Available for slide authoring: <Image asset={${JSON.stringify(m.asset)}} alt=${JSON.stringify(m.name)} />. Use this exact asset reference when the user asks for this image; do not substitute or regenerate it.`,
      ),
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
    const trace = serverNavigationTrace(command.id, command.type, this.data.project.id);
    trace('received');
    return this.serialize(async () => {
      trace('server-queue-released');
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
      trace('pending-saved');
      let result: unknown;
      this.commandTrace = trace;
      try {
        if (command.type === "mode")
          result = await this.mode(command.mode!, command.input ?? "audio");
        else if (command.type === "select") {
          await this.runtime.actors.selectSlide(command.slideId!);
          this.data.build = 0;
        } else if (command.type === "next" || command.type === "previous")
          await this.navigate(command.type === "next" ? 1 : -1);
        else if (command.type === "add") {
          if (this.data.mode !== "talk")
            throw new ProductError(
              "mode",
              "Slides can be added in Talk",
            );
          const slide = await this.runtime.backend.createSlide();
          this.runtime.actors.initializeSlide(slide.id);
        } else if (command.type === "delete") {
          if (this.data.mode !== "talk")
            throw new ProductError("mode", "Slides can be deleted in Talk");
          if (!command.slideId) throw new ProductError("slide_required", "Choose a slide to delete");
          if (this.runtime.backend.list().length <= 1)
            throw new ProductError("last_slide", "Keep at least one slide in the deck");
          result = await this.runtime.backend.deleteSlide(command.slideId);
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
        trace('action-finished', { selectedId: this.runtime.backend.selectedId });
        this.data.commands[command.id] = { fingerprint, result };
        this.data.project.updatedAt = new Date().toISOString();
        await this.save();
        trace('result-saved');
        this.broadcastSnapshot();
        trace('snapshot-broadcast');
        return { snapshot: this.snapshot(), result };
      } catch (error) {
        trace('error');
        this.data.commands[command.id] = { fingerprint, pending: true };
        this.error = safeError(error);
        await this.save();
        this.broadcastSnapshot();
        throw error;
      } finally {
        this.commandTrace = undefined;
      }
    });
  }
  private async mode(mode: Mode, input: "audio" | "transcript") {
    if (!["talk", "present", "practice", "review"].includes(mode))
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
    // An admitted utterance may finish in its original epoch after this transition.
    for (const [id, live] of this.live) if (!live.pending) {
      live.transcriber.close(); this.live.delete(id);
    }
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
  async input(input: Utterance, attachment?: Attachment): Promise<Receipt> {
    return this.serialize(() => {
      if (attachment) this.authorizeCapture(attachment);
      return this.retainInput(input);
    });
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
            this.runtime.actors.initializeSlide(slide.id);
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
    input: AudioPacket,
    pcm: Buffer,
  ): Promise<Receipt> {
    return this.serialize(async () => {
      this.authorizeCapture(a);
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
      if ((!pcm.length && !(input.utteranceId && input.final)) || pcm.length % 2 || pcm.length > 48_000 * 30)
        throw new ProductError(
          "audio",
          "Expected at most30 seconds of mono24k PCM16",
        );
      this.runtime.backend.get(input.slideId);
      if (this.queuedAudioBytes + pcm.length > 8 * 1024 * 1024)
        throw new ProductError("audio_backpressure", "Transcription is catching up. Audio remains in the client retry buffer.");
      await mkdir(join(this.directory, "audio"), { recursive: true });
      await writeFile(
        join(this.directory, "audio", `${digest(input.id)}.pcm`),
        pcm,
        { mode: 0o600 },
      );
      this.data.inputs[input.id] = { fingerprint, pending: true };
      await this.save();
      const mode = this.data.mode;
      const receipt: Receipt = { id: input.id, retained: true, duplicate: false,
        mode, epoch: input.epoch, slideId: input.slideId };
      if (mode === "practice") {
        await this.runtime.practice.addAudio(this.data.practiceId!, input.sequence, input.startMs, pcm);
        this.data.inputs[input.id] = { fingerprint, receipt };
      } else {
        // A receipt acknowledges durable PCM, not completed ASR. Provider latency
        // must not hold the project command queue or prevent the next upload.
        this.data.inputs[input.id] = { fingerprint, receipt, pending: true, audio: input };
        this.queuedAudioBytes += pcm.length;
        this.audioTail = this.audioTail.catch(() => {}).then(() => this.transcribeAudio(a, input, pcm, fingerprint, mode))
          .finally(() => { this.queuedAudioBytes -= pcm.length; });
      }
      await this.save();
      return receipt;
    });
  }
  async settleAudio() { await this.audioTail; }
  private finishAudioTurn(turn: AudioTurn, error?: unknown) {
    clearTimeout(turn.previewTimer);
    if (turn.settled) return;
    turn.settled = true;
    this.providers.finishTranscription(turn.reservation, error);
  }
  private queueSpeechPreview(a: Attachment) {
    const live = this.live.get(a.dto.id), turn = live?.turn;
    if (!live?.pending || !turn || turn.finalized || turn.settled || this.closed) return;
    const remaining = 200 - (Date.now() - turn.lastPreviewAt);
    if (remaining > 0) {
      // Trailing delivery matters: the last word (often the actual topic) must
      // not wait for another ASR delta or the end-of-utterance commit.
      turn.previewTimer ??= setTimeout(() => {
        turn.previewTimer = undefined;
        if (live.turn === turn) this.queueSpeechPreview(a);
      }, remaining);
      return;
    }
    clearTimeout(turn.previewTimer);
    turn.previewTimer = undefined;
    turn.lastPreviewAt = Date.now();
    void this.serialize(async () => {
      if (this.captureOwner !== a.dto.id || !this.sessions.has(a.dto.id) || turn.finalized || turn.mode !== "talk" || turn.input.epoch !== this.data.epoch ||
        this.data.mode !== "talk" || !this.runtime.backend.list().some(s => s.id === turn.input.slideId)) return;
      const text = live.pending?.snapshot().text;
      if (!text || text === turn.lastPreviewText) return;
      // Durable, supersedable recognition evidence. UI remains grey until final ASR.
      const id = `asr_${turn.input.id}_${++turn.revision}`;
      await this.runtime.actors.deliverUtterance({ id, slideId: turn.input.slideId, text,
        deliveredAtMs: turn.input.endMs, correctionOf: turn.correctionOf });
      turn.correctionOf = id;
      turn.lastPreviewText = text;
    }).catch(error => { this.error = safeError(error); this.broadcastSnapshot(); });
  }
  private async transcribeAudio(a: Attachment, input: AudioPacket,
    pcm: Buffer, fingerprint: string, mode: Mode) {
    let turn: AudioTurn | undefined;
    let finished = false;
    try {
      if (this.closed) throw new Error("Audio processing interrupted; PCM retained");
      let live = this.live.get(a.dto.id);
      if (!live) {
        const finals: string[] = [];
        const transcriber = new LiveTranscription(this.providers.client, models().transcription, () => {}, {
          write: (type, data) => {
            this.providers.record({ type, ...data });
            const event = data.event as any;
            if (event && this.live.get(a.dto.id)?.pending?.event(event)) {
              this.broadcastSnapshot();
              if (event.type === "conversation.item.input_audio_transcription.delta") this.queueSpeechPreview(a);
            }
            if (event?.type === "conversation.item.input_audio_transcription.completed") finals.push(event.transcript ?? "");
          }, observation() {},
        }, { maxConnectionAttempts: 1 });
        live = { transcriber, finals, pending: new TranscriptPreview(input.utteranceId ?? input.id, input.epoch, input.slideId) };
        this.live.set(a.dto.id, live);
        await transcriber.connect();
      }
      const utteranceId = input.utteranceId ?? input.id;
      if (live.turn && live.turn.input.id !== utteranceId) throw new Error("Previous utterance must be finalized before another begins");
      if (!live.turn) {
        live.finals.length = 0;
        live.pending = new TranscriptPreview(utteranceId, input.epoch, input.slideId);
        live.turn = { input: { ...input, id: utteranceId }, mode,
          reservation: this.providers.reserveTranscription(), revision: 0, lastPreviewAt: 0 };
      }
      turn = live.turn;
      if (turn.input.slideId !== input.slideId || turn.input.epoch !== input.epoch)
        throw new Error("An audio utterance cannot cross slide or epoch boundaries");
      turn.input.endMs = input.endMs;
      this.broadcastSnapshot();
      if (pcm.length) live.transcriber.append(pcm);
      if (input.final === false) {
        await this.serialize(async () => { this.data.inputs[input.id].pending = false; await this.save(); });
        return;
      }
      await live.transcriber.commit();
      const text = live.finals.join(" ").trim();
      const finalTurn = turn;
      await this.serialize(async () => {
        finalTurn.finalized = true;
        const original = finalTurn.input;
        let receipt: Receipt = { id: original.id, retained: true, duplicate: false,
          mode: finalTurn.mode, epoch: original.epoch, slideId: original.slideId, text };
        if (text || finalTurn.correctionOf) {
          const current = this.captureOwner === a.dto.id && this.sessions.has(a.dto.id) && original.epoch === this.data.epoch && finalTurn.mode === this.data.mode &&
            this.runtime.backend.list().some(slide => slide.id === original.slideId);
          if (current) {
            delete this.data.inputs[original.id];
            receipt = await this.retainInput({ ...original, text, correctionOf: finalTurn.correctionOf });
          } else {
            this.data.transcripts.push({ id: original.id, text, slideId: original.slideId,
              mode: finalTurn.mode, epoch: original.epoch, atMs: original.endMs, correctionOf: finalTurn.correctionOf });
          }
        }
        // Packet receipt remains keyed by its upload ID; transcript by utterance ID.
        this.data.inputs[input.id] = { fingerprint, receipt: { ...receipt, id: input.id }, audio: input };
        await this.save(); this.broadcastSnapshot();
      });
      this.finishAudioTurn(turn);
      finished = true;
      delete live.pending; delete live.turn;
    } catch (error) {
      const live = this.live.get(a.dto.id);
      turn ??= live?.turn;
      if (turn && !finished) this.finishAudioTurn(turn, error);
      live?.transcriber.close(); this.live.delete(a.dto.id);
      await this.serialize(async () => {
        this.providers.record({ type: "audio_failed", id: input.id, error: safeError(error) });
        this.data.inputs[input.id] = { ...this.data.inputs[input.id], fingerprint, pending: false, error: safeError(error) };
        this.error = safeError(error); await this.save(); this.broadcastSnapshot();
      });
    } finally {
      const live = this.live.get(a.dto.id);
      if (finished && live && (input.epoch !== this.data.epoch || this.closed)) {
        live.transcriber.close(); this.live.delete(a.dto.id);
      }
      this.broadcastSnapshot();
    }
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
      try { await this.images.register(material, bytes); }
      catch (error) {
        throw new ProductError('image_invalid', error instanceof Error ? error.message : 'Image could not be registered', 400);
      }
      if (material.text && material.text.length > 100000)
        throw new ProductError(
          "material_large",
          "Text context exceeds100000 characters; bytes remain retained",
        );
      this.data.materials.push(material);
      // Persist the version mapping before canonical source can refer to the image.
      await this.save();
      await this.updateBrief(this.contextText());
      await this.save();
      this.broadcastSnapshot();
      return material;
    });
  }
  async materialImage(id: string) {
    const material = this.data.materials.find(item => item.id === id);
    if (!material?.asset) throw new ProductError('image_missing', 'Image is not available', 404);
    await resolveImage(material.asset, this.images);
    return this.images.resolve(material.asset);
  }
  async navigationDeck(): Promise<NavigationDeck> {
    const trace = serverNavigationTrace(randomUUID(), 'prepare-navigation', this.data.project.id);
    trace('prepare-start');
    const { source } = this.runtime.local.engine.readDocument();
    const revision = this.runtime.local.engine.state().revision;
    const epoch = this.data.epoch;
    const mode = this.data.mode === "present" ? "presentation" : "editor";
    const report = await this.runtime.local.browser.check(source, { reusePublicationChecks: true });
    trace('browser-check-finished');
    if (!report.complete) throw new ProductError("validation_unavailable", "Slide preparation did not complete");
    const presentationReady = ready(report);
    if (mode === "presentation" && !presentationReady)
      throw new ProductError("presentation_blocked", "Deck is not ready for presentation");
    const expanded = expandSource(source, { resolveIcon: readIcon });
    const slides: NavigationDeck['slides'] = [];
    for (const slide of expanded.slides) {
      const artifact = await this.runtime.local.renderer.render(source, slide.id);
      const builds = new Set<number>([0]);
      const visit = (node: any) => {
        builds.add(Number(node.props?.build ?? 0));
        for (const child of node.children ?? []) if (typeof child !== "string") visit(child);
      };
      visit(slide);
      slides.push({ slideId: slide.id, html: artifact.html, css: artifact.css,
        readiness: { revision, ready: presentationReady }, builds: [...builds].sort((a,b) => a-b) });
    }
    if (revision !== this.runtime.local.engine.state().revision || epoch !== this.data.epoch)
      throw new ProductError("revision_changed", "Deck changed during preparation");
    trace('render-finished', { slides: slides.length });
    return { revision, epoch, mode, slides };
  }
  async image(slideId: string, revision?: string) {
    const source = this.runtime.local.engine.readDocument().source;
    const current = this.runtime.local.engine.state().revision;
    if (revision && revision !== current)
      throw new ProductError(
        "revision_changed",
        "Reload the latest slide thumbnail",
      );
    const artifact = await this.runtime.local.renderer.render(source, slideId);
    const key = digest([slideId, artifact.html, artifact.css, artifact.fonts, artifact.dependencies]);
    let pending = this.imageCache.get(key);
    if (!pending) {
      pending = this.runtime.local.browser
        .screenshot(source, [slideId])
        .then((frames) => frames[0].jpeg);
      this.imageCache.set(key, pending);
      void pending.catch(() => { if (this.imageCache.get(key) === pending) this.imageCache.delete(key); });
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
    await this.audioTail;
    for (const live of this.live.values()) if (live.turn) this.finishAudioTurn(live.turn, new Error("Shutdown interrupted utterance; PCM retained"));
    await this.tail;
    await Promise.all(
      [...this.sessions.values()].map((a) => a.publication.close()),
    );
    this.sessions.clear();
    await this.runtime.close();
    await this.saveTail;
    await this.providers.close();
  }
}
export class ProjectStore {
  private owners = new Map<string, Promise<ProjectOwner>>();
  private deletions = new Map<string, Promise<void>>();
  constructor(
    readonly directory: string,
    private factory: RuntimeFactory = createPracticeRuntime,
  ) {}
  async list(): Promise<Project[]> {
    await mkdir(this.directory, { recursive: true });
    const result: Project[] = [];
    for (const id of await readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}$/.test(id) || this.deletions.has(id)) continue;
      try {
        const data = JSON.parse(await readFile(join(this.directory, id, 'project.json'), 'utf8')) as Persisted;
        if (!this.deletions.has(id)) result.push(data.project);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
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
      mode: "talk",
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
      JSON.stringify({ project, epoch: 0, transcripts: [], materials: [], commands: {}, inputs: {} }),
    );
    await this.open(id);
    return project;
  }
  open(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new ProductError("project", "Invalid project ID", 404);
    if (this.deletions.has(id)) throw new ProductError('project_deleted', 'This project is being deleted', 410);
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
  delete(id: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ProductError('project', 'Invalid project ID', 404);
    const existing = this.deletions.get(id);
    if (existing) return existing;
    const pending = (async () => {
      const owner = this.owners.get(id);
      if (owner) {
        try { await (await owner).close(); }
        finally { this.owners.delete(id); }
      }
      // Retain source, uploads and provider evidence outside the active project list.
      await mkdir(join(this.directory, '.deleted'), { recursive: true });
      try { await rename(join(this.directory, id), join(this.directory, '.deleted', id)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    })();
    this.deletions.set(id, pending);
    void pending.finally(() => this.deletions.delete(id)).catch(() => {});
    return pending;
  }
  async close() {
    await Promise.allSettled(this.deletions.values());
    await Promise.all(
      [...this.owners.values()].map(async (pending) => (await pending).close()),
    );
    this.owners.clear();
  }
}

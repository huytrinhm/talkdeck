import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicWrite } from "../storage/files.js";
import { lineHash } from "../hashline.js";
import { nodes, parseSource, textContent } from "../parser.js";
import { childNodes } from "../schema.js";
import { SourceError } from "../contracts.js";
import { JsxBackend } from "../host/jsx-backend.js";
import { SlideRuntime } from "../orchestration/runtime.js";
import { abortable } from "../orchestration/abortable.js";
import type { createLocalRuntime } from "../runtime.js";
import { bindTransaction, makeReads, prepareProposal } from "./proposals.js";
import {
  reviewSchema,
  type PracticeRecord,
  type PracticeEvent,
  type SpeechSpan,
  type Reviewer,
  type Transcriber,
  type ReviewContext,
  type Visit,
  type PreparedProposal,
  type ReviewOutput,
} from "./contracts.js";

type Local = Awaited<ReturnType<typeof createLocalRuntime>>;
export interface PracticeOptions {
  directory: string;
  local: Local;
  backend: JsxBackend;
  actors: SlideRuntime;
  reviewer: Reviewer;
  transcriber?: Transcriber;
  now?: () => number;
  reviewInstructions?: string;
  maxContextBytes?: number;
}
export class PracticeService {
  private records = new Map<string, PracticeRecord>();
  private active?: { record: PracticeRecord; origin: number };
  private jobs = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private writes: Promise<unknown> = Promise.resolve();
  private operations: Promise<unknown> = Promise.resolve();
  private unsubscribers: (() => void)[] = [];
  private closed = false;
  private lifetime = new AbortController();
  private constructor(private options: PracticeOptions) {}
  static async create(options: PracticeOptions) {
    const service = new PracticeService({
      ...options,
      directory: resolve(options.directory),
    });
    await mkdir(service.options.directory, { recursive: true });
    for (const name of await readdir(service.options.directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const record = JSON.parse(
        await readFile(join(service.options.directory, name), "utf8"),
      ) as PracticeRecord;
      if (record.status === "recording" || record.status === "processing") {
        record.status = "failed";
        record.error =
          "Process interrupted; retained evidence can be reviewed again after finalization";
      }
      if (!record.baseline && record.status === "failed") {
        const last = record.events.at(-1);
        const source = last && record.sources[last.revision];
        if (source) {
          record.baseline = { source, revision: lineHash(source) };
          record.endedAtMs = Math.max(
            0,
            ...record.events.map((e) => e.atMs),
            ...record.speech.map((s) => s.endMs),
            ...record.audio.map((a) => a.endMs),
          );
          record.brief = {
            ...record.brief,
            interrupted:
              "Recording interrupted; review covers only retained evidence",
          };
        }
      }
      for (const proposal of record.proposals)
        if (proposal.acceptanceIntent) {
          const revision = options.local.engine.state().revision;
          if (revision === proposal.acceptanceIntent.candidateDigest) {
            proposal.status = "accepted";
            proposal.acceptedRevision = revision;
          } else {
            proposal.status = "stale";
            proposal.error =
              "Interrupted acceptance requires reconciliation against current deck";
          }
          delete proposal.acceptanceIntent;
        }
      service.records.set(record.id, record);
      await service.save(record);
    }
    service.unsubscribers.push(
      options.local.engine.subscribe((event) => {
        service.event(
          "deck_changed",
          { reason: event.reason },
          event.document.source,
        );
      }),
    );
    service.unsubscribers.push(
      options.actors.subscribe((event) => {
        if (event.type === "slide_selected") service.event("slide_selected");
        else if (event.type === "edit_comment_queued")
          service.event("edit_command", {
            id: event.id,
            prompt: event.prompt,
            slideId: event.slideId,
          });
        else if (event.type === "history_changed")
          service.event(event.direction === "undo" ? "undo" : "redo");
      }),
    );
    return service;
  }
  private now() {
    return (this.options.now ?? performance.now.bind(performance))();
  }
  private time() {
    return this.active ? Math.max(0, this.now() - this.active.origin) : 0;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.operations.then(() => {
      if (this.closed) throw new Error("Practice service closed");
      return action();
    });
    this.operations = run.catch(() => {});
    return run;
  }
  private save(record: PracticeRecord) {
    const data = JSON.stringify(record);
    const write = this.writes.then(() =>
      atomicWrite(join(this.options.directory, `${record.id}.json`), data),
    );
    // A previous storage failure never converts a later operation into a silent success.
    this.writes = write.catch(() => {});
    return write;
  }
  private event(
    type: PracticeEvent["type"],
    detail?: unknown,
    source = this.options.local.engine.readDocument().source,
  ) {
    const active = this.active;
    if (!active || active.record.status !== "recording") return;
    const revision = lineHash(source);
    active.record.sources[revision] = source;
    active.record.events.push({
      id: randomUUID(),
      type,
      atMs: this.time(),
      slideId: this.options.backend.selectedId,
      revision,
      detail,
    });
    void this.save(active.record).catch((error) => {
      active.record.status = "failed";
      active.record.error = `Recording storage failed: ${String(error)}`;
    });
  }
  get(id: string) {
    return structuredClone(this.record(id));
  }
  list() {
    return [...this.records.values()].map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt,
      error: r.error,
    }));
  }
  private record(id: string) {
    const r = this.records.get(id);
    if (!r)
      throw new SourceError("missing_practice", "Unknown practice session");
    return r;
  }
  private recording(id: string) {
    const r = this.record(id);
    if (this.active?.record !== r || r.status !== "recording")
      throw new SourceError("practice_state", "Session is not recording");
    return r;
  }
  start(
    brief: Record<string, string | number> = {},
    input: "audio" | "transcript" = "transcript",
  ) {
    return this.serial(async () => {
      if (this.active)
        throw new SourceError(
          "practice_state",
          "Finish or cancel the active rehearsal first",
        );
      if (input === "audio" && !this.options.transcriber)
        throw new SourceError(
          "transcription_unavailable",
          "Audio transcription is not configured",
        );
      await this.options.actors.setPracticeMode(true);
      await this.options.local.engine.settledInput();
      const record: PracticeRecord = {
        version: 1,
        id: randomUUID(),
        startedAt: new Date().toISOString(),
        brief: { ...brief, input },
        status: "recording",
        events: [],
        speech: [],
        audio: [],
        sources: {},
        proposals: [],
        attempts: 0,
      };
      this.records.set(record.id, record);
      this.active = { record, origin: this.now() };
      this.options.actors.practiceInput = async (utterance) => {
        const at = this.time();
        await this.addSpeech(record.id, {
          id: utterance.id,
          startMs: at,
          endMs: at,
          text: utterance.text,
          correctionOf: utterance.correctionOf,
          timing: "receipt",
          slideId: utterance.slideId,
        });
        return {
          utteranceId: utterance.id,
          retainedAtMs: performance.now(),
          pending: false,
        };
      };
      this.event("slide_selected");
      await this.save(record);
      return this.get(record.id);
    });
  }
  addSpeech(id: string, span: SpeechSpan) {
    return this.serial(async () => {
      const r = this.recording(id);
      if (r.brief.input === "audio")
        throw new SourceError(
          "practice_input",
          "Audio sessions are transcribed at finish; do not mix transcript input",
        );
      validateSpan(span);
      const existing = r.speech.find((s) => s.id === span.id);
      if (existing) {
        if (
          JSON.stringify(existing) !== JSON.stringify(span) &&
          !(
            existing.timing === "receipt" &&
            span.timing === "receipt" &&
            existing.text === span.text &&
            existing.correctionOf === span.correctionOf &&
            existing.slideId === span.slideId
          )
        )
          throw new SourceError(
            "practice_input",
            "Conflicting utterance identity",
          );
        return;
      }
      if (
        span.correctionOf &&
        (!r.speech.some((s) => s.id === span.correctionOf) ||
          r.speech.some((s) => s.correctionOf === span.correctionOf))
      )
        throw new SourceError(
          "practice_input",
          "Correction must reference an existing, not-yet-superseded utterance",
        );
      r.speech.push(structuredClone(span));
      await this.save(r);
    });
  }
  addAudio(id: string, sequence: number, startMs: number, pcm: Buffer) {
    const bytes = Buffer.from(pcm);
    return this.serial(async () => {
      const r = this.recording(id);
      if (
        !bytes.length ||
        bytes.length % 2 ||
        bytes.length > 11_520_000 ||
        !Number.isSafeInteger(sequence) ||
        sequence < 0 ||
        !Number.isFinite(startMs) ||
        startMs < 0
      )
        throw new SourceError(
          "practice_audio",
          "Expected <=4 minutes of mono 24kHz PCM16 with a nonnegative sequence/time",
        );
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const existing = r.audio.find((a) => a.sequence === sequence);
      if (existing) {
        if (existing.sha256 !== sha256 || existing.startMs !== startMs)
          throw new SourceError(
            "practice_audio",
            "Conflicting duplicate audio chunk",
          );
        return existing;
      }
      const last = r.audio.at(-1);
      if (
        sequence !== (last ? last.sequence + 1 : 0) ||
        startMs < (last?.endMs ?? 0) - 0.01
      )
        throw new SourceError(
          "practice_audio",
          "Audio sequence or sample clock is out of order",
        );
      const file = `${r.id}-${sequence}.pcm`;
      await writeFile(join(this.options.directory, file), bytes, {
        mode: 0o600,
      });
      const chunk = {
        sequence,
        startMs,
        endMs: startMs + bytes.length / 48,
        bytes: bytes.length,
        sha256,
        file,
      };
      r.audio.push(chunk);
      await this.save(r);
      return structuredClone(chunk);
    });
  }
  async audio(id: string, sequence: number) {
    const chunk = this.record(id).audio.find((c) => c.sequence === sequence);
    if (!chunk) throw new SourceError("missing_audio", "Unknown audio chunk");
    return wav(await this.audioBytes(chunk));
  }
  recordingPause(id: string, paused: boolean) {
    return this.serial(async () => {
      const r = this.recording(id);
      const last = r.events
        .filter((e) => e.type === "pause" || e.type === "resume")
        .at(-1);
      if ((last?.type === "pause") === paused) return;
      this.event(paused ? "pause" : "resume");
      await this.save(r);
    });
  }
  finish(id: string) {
    return this.serial(async () => {
      const r = this.recording(id);
      r.endedAtMs = Math.max(
        this.time(),
        ...r.speech.map((s) => s.endMs),
        ...r.audio.map((a) => a.endMs),
      );
      const source = this.options.local.engine.readDocument().source;
      r.baseline = { source, revision: lineHash(source) };
      this.active = undefined;
      this.options.actors.practiceInput = undefined;
      await this.launch(r);
      return this.get(id);
    });
  }
  retry(id: string) {
    return this.serial(async () => {
      const r = this.record(id);
      if (!["failed", "cancelled"].includes(r.status) || !r.baseline)
        throw new SourceError(
          "practice_state",
          "Retry requires a finalized recording",
        );
      await this.launch(r);
      return this.get(id);
    });
  }
  private async launch(r: PracticeRecord) {
    if (this.jobs.has(r.id))
      throw new SourceError("practice_state", "Review already running");
    r.status = "processing";
    r.error = undefined;
    r.attempts++;
    r.proposals = [];
    r.review = undefined;
    await this.save(r);
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      try {
        if (!r.context) {
          if (r.brief.input === "audio" && !r.speech.length)
            await this.transcribe(r, controller.signal);
          r.context = await this.context(r, controller.signal);
          await this.save(r);
        }
        const raw = await abortable(
          this.options.reviewer.review({
            context: structuredClone(r.context),
            revision: r.revisionRequest && {
              proposal: r.revisionRequest.proposal,
              prompt: r.revisionRequest.prompt,
            },
            change: r.changeRequest,
            signal: controller.signal,
          }),
          controller.signal,
        );
        const review = this.validateReview(raw, r.context);
        if ((r.revisionRequest || r.changeRequest) && review.proposals.length !== 1)
          throw new SourceError(
            "review_revision",
            "A counter-prompt must produce exactly one replacement proposal",
          );
        r.review = review;
        for (const proposal of review.proposals) {
          const prepared = await prepareProposal(
            this.options.local,
            r.context,
            proposal,
            r.context.baseline.source,
            (r.revisionRequest?.proposal.version ?? 0) + 1,
            controller.signal,
          );
          r.proposals.push(prepared);
        }
        controller.signal.throwIfAborted();
        r.status = "ready";
        await this.save(r);
        if (r.revisionRequest && r.proposals[0]?.status === "ready") {
          const prior = this.record(r.revisionRequest.practiceId);
          const original = this.proposal(prior, r.revisionRequest.proposal.id);
          if (original.status !== "accepted") original.status = "superseded";
          await this.save(prior);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          r.status = "failed";
          r.error = String(error);
          await this.save(r);
        }
      } finally {
        this.jobs.delete(r.id);
      }
    });
    void promise.catch((error) => {
      r.status = "failed";
      r.error = `Review persistence failed: ${String(error)}`;
    });
    this.jobs.set(r.id, { controller, promise });
  }
  private validateReview(raw: unknown, context: ReviewContext): ReviewOutput {
    const result = reviewSchema.parse(raw);
    const ids = new Set(context.evidence.map((e) => e.id));
    const feedback = new Set(result.feedback.map((f) => f.id)),
      proposals = new Set(result.proposals.map((p) => p.id));
    if (
      feedback.size !== result.feedback.length ||
      proposals.size !== result.proposals.length
    )
      throw new SourceError(
        "review_reference",
        "Duplicate feedback/proposal IDs",
      );
    for (const item of [...result.feedback, ...result.proposals])
      if (item.evidenceIds.some((id) => !ids.has(id)))
        throw new SourceError("review_reference", "Unknown evidence ID");
    for (const p of result.proposals) {
      if (
        p.feedbackIds.some((id) => !feedback.has(id)) ||
        p.alternativeTo.some((id) => !proposals.has(id) || id === p.id)
      )
        throw new SourceError(
          "review_reference",
          "Unknown feedback or alternative reference",
        );
    }
    return result;
  }
  private async context(
    r: PracticeRecord,
    signal: AbortSignal,
  ): Promise<ReviewContext> {
    const baseline = r.baseline!,
      source = baseline.source;
    const fork = this.options.local.engine.fork({ schemaVersion: 1, source });
    const sourceSlides = childNodes(parseSource(source)).filter(
      (n) => n.tag === "Slide",
    );
    const superseded = new Set(
      r.speech.map((s) => s.correctionOf).filter(Boolean),
    );
    const speech = r.speech
      .filter((s) => !superseded.has(s.id))
      .sort((a, b) => a.startMs - b.startMs);
    // Host selection/source revision boundaries define visits, not verified audience paint.
    const boundaries = r.events
      .filter((e) =>
        ["slide_selected", "deck_changed", "undo", "redo"].includes(e.type),
      )
      .sort((a, b) => a.atMs - b.atMs);
    const visits: Visit[] = boundaries.map((event, i) => {
      const endMs = boundaries[i + 1]?.atMs ?? r.endedAtMs!;
      return {
        id: `visit-${i + 1}`,
        slideId: event.slideId,
        revision: event.revision,
        startMs: event.atMs,
        endMs,
        speechIds: speech
          .filter(
            (s) =>
              s.startMs < endMs &&
              s.endMs >= event.atMs &&
              (!s.slideId || s.slideId === event.slideId),
          )
          .map((s) => s.id),
      };
    });
    let pausedMs = 0,
      pausedAt: number | undefined;
    for (const e of r.events) {
      if (e.type === "pause" && pausedAt === undefined) pausedAt = e.atMs;
      if (e.type === "resume" && pausedAt !== undefined) {
        pausedMs += e.atMs - pausedAt;
        pausedAt = undefined;
      }
    }
    if (pausedAt !== undefined) pausedMs += r.endedAtMs! - pausedAt;
    const wordCount = speech.reduce(
      (n, s) => n + s.text.trim().split(/\s+/).filter(Boolean).length,
      0,
    );
    const durationMs = r.endedAtMs!,
      activeMs = durationMs - pausedMs;
    const context: ReviewContext = {
      version: 1,
      practiceId: r.id,
      instructions:
        this.options.reviewInstructions ??
        "Review all supplied rehearsal evidence and propose useful conservative changes; preserve substantive facts, qualifiers and original source evidence. Absence claims apply only to the supplied effective transcript, not unrecorded or unrecognized speech.",
      brief: r.brief,
      design: this.options.backend.designContext("review"),
      baseline: { ...baseline, reads: makeReads(fork, source) },
      slides: sourceSlides.map((s) => {
        const evidence = fork.readSpeakerNotes(s.id!);
        return {
          id: s.id!,
          notes: evidence.notes,
          originalTranscript: evidence.transcript,
        };
      }),
      speech,
      speechHistory: r.speech,
      coverage: {
        speech: {
          effectiveField: "speech",
          historyField: "speechHistory",
          supersededIds: r.speech
            .filter((s) => superseded.has(s.id))
            .map((s) => s.id),
          completeness: "unknown",
          semantics:
            "speech contains effective, non-superseded spans in time order. speechHistory retains the original spans and corrections; repeated IDs across these fields are the same evidence, not additional speech. Aligned timestamps do not establish complete recognition or recording coverage.",
        },
        audio: {
          providedToReviewer: false,
          recordedIntervals: r.audio.map(({ startMs, endMs }) => ({
            startMs,
            endMs,
          })),
        },
        recognition: {
          source:
            r.brief.input === "audio" ? "transcriber" : "provided_transcript",
          completeness: "unknown",
        },
        absenceClaims:
          "Limit absence claims to the supplied effective transcript. Missing spans or audio intervals do not establish silence or omission by the speaker; recognition may omit or normalize speech. No audio is supplied for delivery judgments.",
        convenienceExtracts:
          "slides[].notes and slides[].originalTranscript are convenience extracts of the same baseline source evidence, not independent corroboration or additional rehearsal speech. baseline.reads repeats that source with executable anchors. Final-baseline images are review-time renders, not captures of audience-visible rehearsal frames.",
      },
      events: r.events,
      visits,
      priorDecks: Object.entries(r.sources)
        .filter(([revision]) => revision !== baseline.revision)
        .map(([revision, source]) => ({ revision, source })),
      measurements: {
        id: "timing-summary",
        durationMs,
        pausedMs,
        wordCount,
        approximateWordsPerMinute:
          activeMs > 0 ? (wordCount * 60000) / activeMs : null,
        caveat:
          "Approximate transcript words per unpaused session minute, not articulation rate. ASR may normalize fillers. Receipt-timed spans are not acoustic alignments. No audio/prosody judgments are established by text alone. Visits reflect host selection/source events, not verified audience paint; do not claim pixel visibility from these records.",
      },
      images: [],
      evidence: [
        ...[...nodes(parseSource(source))].map((n) => ({
          id: n.id!,
          kind: "source" as const,
          revision: baseline.revision,
        })),
        ...r.speech.map((s) => ({ id: s.id, kind: "speech" as const })),
        ...r.events.map((e) => ({
          id: e.id,
          kind: "event" as const,
          revision: e.revision,
        })),
        ...visits.map((v) => ({
          id: v.id,
          kind: "visit" as const,
          revision: v.revision,
        })),
        { id: "timing-summary", kind: "measurement" as const },
      ],
    };
    for (const slide of sourceSlides) {
      signal.throwIfAborted();
      const image = (
        await this.options.local.browser.screenshot(source, [slide.id!])
      )[0];
      context.images.push({
        slideId: slide.id!,
        sourceRevision: baseline.revision,
        evidenceId: `render-${slide.id!}`,
        provenance: "final_baseline_render",
        jpeg: Buffer.from(image.jpeg).toString("base64"),
      });
      context.evidence.push({
        id: `render-${slide.id!}`,
        kind: "render",
        slideId: slide.id!,
        revision: baseline.revision,
        provenance: "final_baseline_render",
      });
    }
    if (
      new Set(context.evidence.map((e) => e.id)).size !==
      context.evidence.length
    )
      throw new SourceError(
        "review_reference",
        "Evidence identifiers collide; use distinct stable utterance IDs",
      );
    if (
      Buffer.byteLength(JSON.stringify(context)) >
      (this.options.maxContextBytes ?? 24 * 1024 * 1024)
    )
      throw new SourceError(
        "review_context_limit",
        "Complete review context exceeds configured limit; nothing was silently summarized or truncated",
      );
    signal.throwIfAborted();
    return structuredClone(context);
  }
  private async audioBytes(chunk: PracticeRecord["audio"][number]) {
    const bytes = await readFile(join(this.options.directory, chunk.file));
    if (
      bytes.length !== chunk.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== chunk.sha256
    )
      throw new SourceError(
        "practice_audio",
        "Stored audio integrity check failed",
      );
    return bytes;
  }
  private async transcribe(r: PracticeRecord, signal: AbortSignal) {
    if (!r.audio.length)
      throw new SourceError("practice_audio", "No audio recorded");
    if (!this.options.transcriber)
      throw new SourceError(
        "transcription_unavailable",
        "Transcriber not configured",
      );
    const spans: SpeechSpan[] = [];
    // Batch contiguous samples up to four minutes; map audio time back to rehearsal time.
    let group: typeof r.audio = [],
      length = 0;
    const flush = async () => {
      if (!group.length) return;
      const pcm = Buffer.concat(
        await Promise.all(group.map((c) => this.audioBytes(c))),
      );
      const segments = await abortable(
        this.options.transcriber!.transcribe(pcm, signal),
        signal,
      );
      const map = (ms: number, end: boolean) => {
        let offset = 0;
        for (const chunk of group) {
          const duration = chunk.bytes / 48;
          if (ms < offset + duration || (end && ms === offset + duration))
            return chunk.startMs + Math.max(0, ms - offset);
          offset += duration;
        }
        return group.at(-1)!.endMs;
      };
      for (const s of segments) {
        if (
          !Number.isFinite(s.startMs) ||
          !Number.isFinite(s.endMs) ||
          s.startMs < 0 ||
          s.endMs < s.startMs ||
          s.endMs > pcm.length / 48 + 100
        )
          throw new SourceError(
            "transcription_timing",
            "Transcriber returned an invalid audio interval",
          );
        const span: SpeechSpan = {
          id: `audio-${spans.length + 1}`,
          startMs: map(s.startMs, false),
          endMs: map(s.endMs, true),
          text: s.text,
          timing: "aligned",
        };
        validateSpan(span);
        spans.push(span);
      }
      group = [];
      length = 0;
    };
    for (const c of r.audio) {
      if (length + c.bytes > 11_520_000) await flush();
      group.push(c);
      length += c.bytes;
    }
    await flush();
    signal.throwIfAborted();
    r.speech = spans;
    await this.save(r);
  }
  async wait(id: string) {
    await this.jobs.get(id)?.promise;
    return this.get(id);
  }
  cancel(id: string) {
    return this.serial(async () => {
      const r = this.record(id);
      if (r.status !== "recording" && r.status !== "processing")
        throw new SourceError("practice_state", "Nothing is running");
      if (this.active?.record === r) {
        this.active = undefined;
        this.options.actors.practiceInput = undefined;
      }
      const job = this.jobs.get(id);
      job?.controller.abort();
      await job?.promise;
      r.status = "cancelled";
      await this.save(r);
      return this.get(id);
    });
  }
  reject(id: string, proposalId: string) {
    return this.serial(async () => {
      const r = this.record(id),
        p = this.proposal(r, proposalId);
      if (p.status === "accepted")
        throw new SourceError(
          "proposal_state",
          "Use undo for an accepted change",
        );
      p.status = "rejected";
      await this.save(r);
      return structuredClone(p);
    });
  }
  private proposal(r: PracticeRecord, id: string) {
    const p = r.proposals.find((p) => p.id === id);
    if (!p) throw new SourceError("missing_proposal", "Unknown proposal");
    return p;
  }
  accept(id: string, proposalId: string, version: number) {
    return this.serial(async () => {
      const r = this.record(id),
        p = this.proposal(r, proposalId);
      if (r.status !== "ready")
        throw new SourceError("practice_state", "Review is not complete");
      if (p.status === "accepted") return structuredClone(p); // Idempotent retry; never creates a second undo unit.
      if (p.status !== "ready" || p.version !== version)
        throw new SourceError(
          "proposal_state",
          "Accept requires the current ready preview version",
        );
      if (
        r.proposals.some(
          (other) =>
            other.status === "accepted" &&
            (p.alternativeTo.includes(other.id) ||
              other.alternativeTo.includes(p.id)),
        )
      )
        throw new SourceError(
          "proposal_state",
          "An alternative proposal was already accepted",
        );
      const signal = this.lifetime.signal;
      const current = this.options.local.engine.readDocument().source;
      let prepared = p;
      // Source equality cannot prove identical font, asset, renderer or measured preview bytes.
      // Always privately restage and compare the complete prepared bundle before acceptance.
      {
        prepared = await prepareProposal(
          this.options.local,
          r.context!,
          p,
          current,
          p.version + 1,
          signal,
        );
        if (
          prepared.status !== "ready" ||
          prepared.previewSignature !== p.previewSignature
        ) {
          if (prepared.status !== "ready") prepared.status = "stale";
          Object.assign(p, prepared);
          await this.save(r);
          return structuredClone(p); // Refresh, not implicit approval.
        }
      }
      try {
        const transaction = bindTransaction(
          this.options.local.engine,
          r.context!.baseline.source,
          r.context!.baseline.reads,
          p,
        );
        p.acceptanceIntent = {
          candidateDigest: prepared.candidateDigest!,
          expectedRevision: lineHash(current),
        };
        await this.save(r);
        const result = await this.options.backend.acceptProposal(
          transaction,
          lineHash(current),
          prepared.candidateDigest!,
          signal,
        );
        if (!result.accepted) {
          p.status = "stale";
          p.findings = result.findings;
          p.error = "Live validation changed; refresh before acceptance";
        } else {
          p.status = "accepted";
          p.acceptedRevision = result.revision;
        }
      } catch (error) {
        const revision = this.options.local.engine.state().revision;
        if (
          p.acceptanceIntent &&
          revision === p.acceptanceIntent.candidateDigest
        ) {
          p.status = "accepted";
          p.acceptedRevision = revision;
          p.error = `Commit occurred; follow-up confirmation failed: ${String(error)}`;
        } else {
          p.status = "stale";
          p.error = String(error);
        }
      }
      delete p.acceptanceIntent;
      await this.save(r);
      return structuredClone(p);
    });
  }
  refresh(id: string, proposalId: string) {
    return this.serial(async () => {
      const r = this.record(id),
        p = this.proposal(r, proposalId);
      if (["accepted", "rejected", "superseded"].includes(p.status))
        throw new SourceError("proposal_state", "Proposal is terminal");
      const prepared = await prepareProposal(
        this.options.local,
        r.context!,
        p,
        this.options.local.engine.readDocument().source,
        p.version + 1,
        this.lifetime.signal,
      );
      if (prepared.status === "invalid") prepared.status = "stale";
      Object.assign(p, prepared);
      await this.save(r);
      return structuredClone(p);
    });
  }
  revise(id: string, proposalId: string, prompt: string) {
    return this.serial(async () => {
      if (!prompt.trim())
        throw new SourceError("request", "Revision prompt is empty");
      const r = this.record(id),
        p = this.proposal(r, proposalId);
      if (p.status === "accepted")
        throw new SourceError(
          "proposal_state",
          "Accepted proposal cannot be revised",
        );
      const source = this.options.local.engine.readDocument().source;
      // A separate background revision keeps the old proposal/context immutable.
      const next: PracticeRecord = {
        ...structuredClone(r),
        id: randomUUID(),
        baseline: { source, revision: lineHash(source) },
        context: undefined,
        review: undefined,
        status: "processing",
        proposals: [],
        attempts: 0,
        changeRequest: undefined,
        revisionRequest: {
          practiceId: r.id,
          proposal: structuredClone(p),
          prompt,
        },
      };
      this.records.set(next.id, next);
      await this.launch(next);
      return this.get(next.id);
    });
  }
  /** An explicit review request with no prior proposal still uses private staging and exact-version acceptance. */
  requestChange(id: string, slideId: string, prompt: string) {
    return this.serial(async () => {
      const prior = this.record(id);
      if (prior.status === "recording" || prior.status === "processing")
        throw new SourceError("practice_state", "Finish the current recording/review first");
      if (!prompt.trim() || prompt.length > 100_000)
        throw new SourceError("request", "A bounded change prompt is required");
      const source = this.options.local.engine.readDocument().source;
      if (!childNodes(parseSource(source)).some(n => n.tag === "Slide" && n.id === slideId))
        throw new SourceError("missing_slide", "The requested slide no longer exists");
      const next: PracticeRecord = {
        ...structuredClone(prior), id: randomUUID(), baseline: {source, revision:lineHash(source)},
        context: undefined, review: undefined, status: "processing", proposals: [], attempts: 0,
        revisionRequest: undefined, changeRequest: {slideId, prompt:prompt.trim()}, error: undefined,
      };
      this.records.set(next.id, next);
      await this.launch(next);
      return this.get(next.id);
    });
  }
  async leavePractice() {
    return this.serial(async () => {
      if (this.active)
        throw new SourceError(
          "practice_state",
          "Finish or cancel recording first",
        );
      await this.options.actors.setPracticeMode(false);
    });
  }
  async close() {
    this.closed = true;
    this.lifetime.abort(new Error("Practice service closed"));
    this.options.actors.practiceInput = undefined;
    for (const off of this.unsubscribers) off();
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map((j) => j.promise));
    await this.operations;
    await this.writes;
  }
}
function validateSpan(span: SpeechSpan) {
  if (
    !span.id ||
    typeof span.text !== "string" ||
    span.text.length > 100_000 ||
    !Number.isFinite(span.startMs) ||
    !Number.isFinite(span.endMs) ||
    span.startMs < 0 ||
    span.endMs < span.startMs
  )
    throw new SourceError(
      "practice_input",
      "Invalid timestamped transcript span",
    );
}
export function wav(pcm: Buffer) {
  const h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24);
  h.writeUInt32LE(48000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

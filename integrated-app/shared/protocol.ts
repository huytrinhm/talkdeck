/** Product facade v1. Canonical source is server-owned; slides below are projections. */
export type Mode = "talk" | "present" | "practice" | "review";
export interface Project {
  id: string;
  schema: "talkdeck-canonical-v1";
  name: string;
  context: string;
  createdAt: string;
  updatedAt: string;
}
export interface Material {
  id: string;
  name: string;
  bytes: number;
  mime: string;
  status: "extracted" | "reference-only";
  text?: string;
}
export interface Transcript {
  id: string;
  text: string;
  slideId: string;
  mode: Mode;
  epoch: number;
  atMs: number;
  correctionOf?: string;
}
export interface Snapshot {
  protocol: 1;
  project: Project;
  revision: string;
  mode: Mode;
  epoch: number;
  selectedId: string;
  slides: { id: string; title: string; notes: string; thumbnail: string }[];
  transcripts: Transcript[];
  materials: Material[];
  practiceId?: string;
  actors: {
    id: string;
    role: string;
    state: string;
    paused: boolean;
    error?: string;
  }[];
  build: number;
  blackout: boolean;
  generationPaused: boolean;
  usage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    failures: number;
    maxCalls: number;
    maxTokens: number;
    unknownUsage: number;
  };
  serverTimeMs: number;
  modeStartedAtMs: number;
  error?: string;
}
export interface Session {
  id: string;
  token: string;
  projectId: string;
  role: "editor" | "audience";
  channel: string;
  viewerDocument: string;
  snapshot?: Snapshot;
  serverTimeMs: number;
  serverMonotonicMs: number;
}
export interface Command {
  id: string;
  epoch: number;
  type:
    | "mode"
    | "select"
    | "next"
    | "previous"
    | "add"
    | "delete"
    | "pause"
    | "resume"
    | "blackout"
    | "build"
    | "context"
    | "push-to-edit";
  mode?: Mode;
  slideId?: string;
  value?: boolean | number;
  context?: string;
  prompt?: string;
  input?: "audio" | "transcript";
}
export interface Utterance {
  id: string;
  epoch: number;
  slideId: string;
  text: string;
  startMs: number;
  endMs: number;
  correctionOf?: string;
}
export interface Receipt {
  id: string;
  retained: boolean;
  duplicate: boolean;
  mode: Mode;
  epoch: number;
  slideId: string;
  text?: string;
}
export type ServerEvent = {
  id: number;
  type: "snapshot" | "viewer" | "blackout" | "resync" | "error" | "receipt";
  data: unknown;
};
/**
 * GET/POST /api/projects -> Project[] / Project (POST {name,context?})
 * POST /api/projects/:project/sessions {role?:'editor'|'audience'} -> Session
 * All remaining requests send X-Session-Id + X-Session-Token; SSE/image URLs may use ?session=ID&token=TOKEN.
 * GET /api/projects/:project/state -> Snapshot (editor only)
 * GET /api/projects/:project/events -> SSE named snapshot/viewer/blackout/error/resync/receipt with numeric id.
 * GET /api/projects/:project/viewer -> {channel,viewerDocument,message?,blackout}; use on iframe ready/reconnect.
 * POST /api/projects/:project/viewer/ack {acknowledgment,clock:{offsetMs,uncertaintyMs}}
 * POST /api/projects/:project/commands Command -> {snapshot,result?}
 * POST /api/projects/:project/input Utterance -> Receipt (explicit transcript mode)
 * POST /api/projects/:project/audio raw mono24k PCM16, headers X-Input-Id,X-Epoch,X-Slide-Id,X-Start-Ms,X-End-Ms,X-Audio-Sequence -> Receipt.
 * Practice audio sequences start at zero per recording. Talk/Present chunks are finalized independently using live ASR; durable IDs prevent paid retry.
 * GET /api/projects/:project/slides/:slide/image?revision=... -> canonical JPEG
 * POST /api/projects/:project/materials FormData file -> Material (bytes retained, supported text extracted)
 * POST /api/projects/:project/practice/:id/finish|retry|cancel|pause|resume and proposal routes proxy existing PracticeService.
 * GET /api/projects/:project/practice/:id -> existing PracticeRecord (images/diff/version)
 * POST /api/projects/:project/practice/:id/request-change {slideId,prompt}
 */

/** Immutable renderer output prepared for local navigation; never editable slide data. */
export interface NavigationDeck {
  revision: string;
  epoch: number;
  mode: 'editor' | 'presentation';
  slides: {
    slideId: string;
    html: string;
    css: string;
    readiness: { revision: string; ready: boolean };
    builds: number[];
  }[];
}

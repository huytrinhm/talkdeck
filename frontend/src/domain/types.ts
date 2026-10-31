export type Theme = "paper" | "midnight" | "lavender";
export type Layout =
  "title" | "bullets" | "process" | "comparison" | "quote" | "table" | "code";
export interface TableData {
  name: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  aliases?: string[];
}
export interface Material {
  id: string;
  name: string;
  type: string;
  size: number;
  blobKey: string;
  text?: string;
  tables?: TableData[];
  status: "ready" | "reference" | "error";
}
export interface Slide {
  id: string;
  title: string;
  body: string[];
  notes: string;
  layout: Layout;
  theme: Theme;
  tableData?: TableData;
  materialRef?: { materialId: string; tableName: string; page?: number };
}
export interface TranscriptSegment {
  id: string;
  slideId: string;
  text: string;
  start: number;
  end: number;
  provisional?: boolean;
  /** Absent on legacy saved entries; never infer their capture source. */
  inputSource?: "device" | "phone";
  captureSessionId?: string;
  capturedAt?: number;
}
export interface Proposal {
  id: string;
  slideId: string;
  type: "fields" | "split" | "reorder";
  title: string;
  reason: string;
  before: Slide;
  after: Slide;
  fields: (keyof Slide)[];
  status: "pending" | "accepted" | "rejected";
  extraSlides?: Slide[];
  order?: string[];
  baseOrder?: string[];
  materialFingerprint?: string;
}
export interface Rehearsal {
  id: string;
  snapshot: Slide[];
  transcript: TranscriptSegment[];
  elapsed: number;
  proposals: Proposal[];
  createdAt: number;
  completedAt?: number;
}
export interface Project {
  id: string;
  title: string;
  description: string;
  systemPrompt: string;
  materials: Material[];
  slides: Slide[];
  transcript: TranscriptSegment[];
  createdAt: number;
  updatedAt: number;
  status: "draft" | "ready";
  theme: Theme;
  rehearsals: Rehearsal[];
}
export interface Workspace {
  version: 3;
  projects: Project[];
}
export const DEFAULT_PROMPT =
  "Turn my spoken ideas into clear, concise presentation slides. Keep one idea per slide. Use diagrams for processes and comparisons. Preserve my meaning and never invent facts.";
export const uid = () => crypto.randomUUID();
export const blankSlide = (theme: Theme = "paper"): Slide => ({
  id: uid(),
  title: "Untitled slide",
  body: [],
  notes: "",
  layout: "title",
  theme,
});
export const emptyWorkspace = (): Workspace => ({
  version: 3,
  projects: [],
});
export const newProject = (projects: Project[]): Project => {
  let n = 1;
  while (projects.some((p) => p.title.toLowerCase() === `untitled ${n}`)) n++;
  return {
    id: uid(),
    title: `Untitled ${n}`,
    description: "",
    systemPrompt: DEFAULT_PROMPT,
    materials: [],
    slides: [],
    transcript: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "draft",
    theme: "paper",
    rehearsals: [],
  };
};

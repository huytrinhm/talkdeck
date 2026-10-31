import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Mic,
  Timer,
  Presentation,
  Monitor,
  SlidersHorizontal,
  Download,
  PanelRight,
  PanelRightClose,
  Check,
  Pause,
  Play,
  MicOff,
  ChevronLeft,
  ChevronRight,
  Maximize,
  MonitorOff,
  MonitorCheck,
  Undo2,
  Settings,
} from "lucide-react";
import {
  Button,
  Input,
  Textarea,
  Modal,
  Menu,
  MenuItem,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui";
import { SlideView } from "../components/SlideView";
import { VoiceCapsule } from "./workspace/VoiceCapsule";
import { Transcript } from "./workspace/Transcript";
import { usePhoneVoice } from "./PhoneVoice";
import type { SettingsTab } from "./GlobalSettings";
import { phoneVoice } from "../services/phoneVoice";
import { Filmstrip } from "../components/Filmstrip";
import { Audience } from "../components/Audience";
import { Materials } from "./Materials";
import { PracticeCoach } from "./PracticeCoach";
import { PracticeCoachController } from "../services/practiceCoach";
import { Review } from "./Review";
import { Annotations } from "./Annotations";
import { type SpeechState } from "../services/speech";
import { frontendAdapters, type SpeechSessionPort } from "../services/adapters";
import { buildRehearsal } from "../domain/review";
import {
  publishAudience,
  publicSlide,
  type AudiencePayload,
} from "../services/audience";
import { exportProject } from "../services/export";
import {
  uid,
  blankSlide,
  type Project,
  type Slide,
  type Layout,
  type TranscriptSegment,
} from "../domain/types";
export type Mode =
  "edit" | "create" | "present" | "practice" | "review" | "context";
const formatTime = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
export const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input,textarea,select,[contenteditable=true]"));
export const hasOverlay = () =>
  Boolean(
    document.querySelector(
      "[role=dialog],[role=menu],[data-radix-popper-content-wrapper]",
    ),
  );
function IconButton({
  label,
  children,
  onClick,
  disabled,
  pressed,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={pressed}
      className={pressed ? "panel-selected" : ""}
    >
      {children}
    </Button>
  );
}
export function Workspace({
  project,
  mode,
  onChange,
  onMode,
  onBack,
  onAppSettings,
  speechSuspended = false,
  claimInputStart,
}: {
  project: Project;
  mode: Mode;
  onChange: (p: Project) => void;
  onMode: (m: Mode) => void;
  onBack: () => void;
  onAppSettings?: (tab?: SettingsTab) => void;
  speechSuspended?: boolean;
  claimInputStart?: () => boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    project.slides[0]?.id ?? null,
  );
  const [sidebar, setSidebar] = useState(true),
    [tab, setTab] = useState("transcript");
  const [settings, setSettings] = useState(false);
  const { source: voiceSource } = usePhoneVoice();
  const [audience, setAudience] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [black, setBlack] = useState(false);
  const [target, setTarget] = useState<"audience" | "agent">("audience"),
    [held, setHeld] = useState(false);
  const [speechState, setSpeechState] = useState<SpeechState>({
    status: "idle",
    muted: false,
  });
  const sessionTranscriptIds = useRef(new Set<string>());
  const captureSession = useRef<{
    id: string;
    source: "device" | "phone";
  } | null>(null);
  const interimRef = useRef("");
  const [interim, setInterim] = useState(""),
    [level, setLevel] = useState(0),
    [elapsed, setElapsed] = useState(0),
    [notice, setNotice] = useState("");
  const [history, setHistory] = useState<Project[]>([]),
    [exporting, setExporting] = useState(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const selectionRef = useRef(selectedId);
  selectionRef.current = selectedId;
  const targetRef = useRef(target);
  targetRef.current = held ? "agent" : target;
  const callbacks = useRef({ onChange, onMode });
  callbacks.current = { onChange, onMode };
  const historyRef = useRef<Project[]>([]),
    speech = useRef<SpeechSessionPort | null>(null);
  const elapsedRef = useRef(0),
    lastTick = useRef(performance.now()),
    active = useRef(false),
    utteranceStart = useRef(0),
    utteranceTarget = useRef<"agent" | "audience" | null>(null),
    utteranceSlide = useRef<string | null>(null);
  const practice = useRef({
    id: uid(),
    snapshot: structuredClone(project.slides),
    transcript: [] as TranscriptSegment[],
  });
  const [coach] = useState(
    () =>
      new PracticeCoachController(() => ({
        projectId: projectRef.current.id,
        rehearsalId: practice.current.id,
        slideId: selectionRef.current ?? "",
        slideTitle:
          projectRef.current.slides.find((s) => s.id === selectionRef.current)
            ?.title ?? "",
        transcript: practice.current.transcript.map(
          ({ text, slideId, start, end }) => ({ text, slideId, start, end }),
        ),
      })),
  );
  useEffect(() => {
    const pauseCoach = () => {
      if (mode === "practice") {
        preserveRef.current();
        speech.current?.pause();
        coach.pause();
      }
    };
    const hide = () => {
      if (document.hidden) pauseCoach();
    };
    const leave = () => coach.dispose();
    window.addEventListener("pagehide", leave);
    window.addEventListener("blur", pauseCoach);
    document.addEventListener("visibilitychange", hide);
    return () => {
      coach.dispose();
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("blur", pauseCoach);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [coach, mode]);
  const preserveRef = useRef<() => void>(() => {});
  const stage = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLDivElement>(null);
  const speechSourceInitialized = useRef(false);
  const enabled = ["create", "present", "practice"].includes(mode);
  const selected =
    project.slides.find((s) => s.id === selectedId) ?? project.slides[0];
  const index = project.slides.findIndex((s) => s.id === selected?.id);
  function mutate(p: Project, record = true) {
    if (p === projectRef.current) return;
    if (record) {
      historyRef.current = [
        ...historyRef.current,
        structuredClone(projectRef.current),
      ].slice(-30);
      setHistory(historyRef.current);
    }
    const next = {
      ...p,
      updatedAt: Date.now(),
      status: p.slides.length ? ("ready" as const) : ("draft" as const),
    };
    projectRef.current = next;
    onChange(next);
  }
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const undo = () => {
    const prev = historyRef.current.pop();
    if (prev) {
      setHistory([...historyRef.current]);
      mutate(prev, false);
      setSelectedId((old) =>
        prev.slides.some((s) => s.id === old)
          ? old
          : (prev.slides[0]?.id ?? null),
      );
    }
  };
  const show = (message: string) => {
    setNotice(message);
  };
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      if (active.current) {
        elapsedRef.current += (now - lastTick.current) / 1000;
        setElapsed(elapsedRef.current);
      }
      lastTick.current = now;
    }, 100);
    return () => clearInterval(id);
  }, []);
  function settleTime() {
    const now = performance.now();
    if (active.current) elapsedRef.current += (now - lastTick.current) / 1000;
    lastTick.current = now;
    setElapsed(elapsedRef.current);
  }
  useEffect(() => {
    if (!enabled) return;
    const createSpeech =
      voiceSource === "phone"
        ? phoneVoice.createSpeech.bind(phoneVoice)
        : frontendAdapters.createSpeech;
    let live = true,
      generation = 0,
      requested = false,
      muted = false,
      resumeAfterMute = false;
    let source: SpeechSessionPort | null = null;
    const valid = (epoch: number) => live && requested && generation === epoch;
    const create = () => {
      const epoch = ++generation;
      return createSpeech({
        onState: (state) => {
          if (!valid(epoch)) return;
          if (state.status !== "listening" || state.muted)
            preserveRef.current();
          settleTime();
          active.current = state.status === "listening" && !state.muted;
          muted = state.muted;
          if (["idle", "error"].includes(state.status)) {
            requested = false;
            generation++;
          }
          setSpeechState(state);
        },
        onInterim: (text) => {
          if (!valid(epoch) || !active.current) return;
          if (!text && interimRef.current.trim()) preserveRef.current();
          interimRef.current = text;
          if (!text) {
            utteranceTarget.current = null;
            utteranceSlide.current = null;
            utteranceStart.current = elapsedRef.current;
          }
          if (text && !utteranceTarget.current) {
            utteranceTarget.current = targetRef.current;
            utteranceSlide.current = selectionRef.current;
            utteranceStart.current = elapsedRef.current;
          }
          setInterim(text);
        },
        onLevel: (value) => {
          if (valid(epoch) && active.current) setLevel(value);
        },
        onFinal: (text) => {
          if (!valid(epoch) || !active.current || !text.trim()) return;
          const p = projectRef.current;
          const selected = utteranceSlide.current ?? selectionRef.current;
          const start = utteranceStart.current;
          const result = frontendAdapters.interpret(
            p,
            selected,
            text,
            utteranceTarget.current ?? targetRef.current,
            mode === "practice"
              ? "practice"
              : mode === "present"
                ? "present"
                : "create",
          );
          const segment = {
            id: uid(),
            slideId: result.selectedId ?? selected ?? "",
            text,
            start,
            end: Math.max(start, elapsedRef.current),
            inputSource: captureSession.current?.source,
            captureSessionId: captureSession.current?.id,
            capturedAt: Date.now(),
          };
          sessionTranscriptIds.current.add(segment.id);
          if (mode === "practice") {
            practice.current.transcript.push(segment);
            const next = { ...p, transcript: [...p.transcript, segment] };
            projectRef.current = next;
            onChange(next);
          } else
            mutateRef.current({
              ...result.project,
              transcript: [...result.project.transcript, segment],
            });
          setSelectedId(result.selectedId);
          selectionRef.current = result.selectedId;
          interimRef.current = "";
          setInterim("");
          utteranceTarget.current = null;
          utteranceSlide.current = null;
          utteranceStart.current = elapsedRef.current;
          if (result.message) show(result.message);
        },
      });
    };
    // Rebuild each capture session so callbacks from a cancelled session remain invalid
    // even after the user explicitly resumes. Invalidate BEFORE disposal callbacks.
    const suspend = (status: "paused" | "idle", message?: string) => {
      preserveRef.current();
      requested = false;
      generation++;
      settleTime();
      active.current = false;
      const previous = source;
      source = null;
      previous?.dispose();
      setLevel(0);
      setSpeechState({ status, muted, message });
    };
    const start = () => {
      if (!live || muted) return;
      suspend("paused");
      requested = true;
      captureSession.current = {
        id: uid(),
        source: voiceSource === "phone" ? "phone" : "device",
      };
      source = create();
      source.start();
    };
    const adapter: SpeechSessionPort = {
      start,
      resume: start,
      retry: start,
      pause: () => {
        resumeAfterMute = false;
        suspend("paused", "Microphone paused.");
      },
      stop: () => {
        resumeAfterMute = false;
        suspend("idle");
      },
      setMuted: (value) => {
        if (!live) return;
        if (voiceSource === "phone") {
          preserveRef.current();
          if (source) source.setMuted(value);
          else phoneVoice.setMuted(value);
          muted = value;
          setSpeechState((state) => ({ ...state, muted: value }));
          return;
        }
        if (value === muted) return;
        if (value) {
          resumeAfterMute = requested;
          muted = true;
          suspend("paused", "Microphone muted.");
        } else {
          muted = false;
          const resume = resumeAfterMute;
          resumeAfterMute = false;
          if (resume) start();
          else
            setSpeechState({
              status: "paused",
              muted: false,
              message: "Microphone paused.",
            });
        }
      },
      dispose: () => {
        if (!live) return;
        preserveRef.current();
        requested = false;
        generation++;
        live = false;
        resumeAfterMute = false;
        active.current = false;
        source?.dispose();
        source = null;
      },
    };
    speech.current = adapter;
    if (!speechSourceInitialized.current) {
      speechSourceInitialized.current = true;
      const intended = claimInputStart?.() ?? false;
      if (!speechSuspended && intended) adapter.start();
      else adapter.pause();
    } else adapter.pause();
    const leave = () => {
      preserveRef.current();
      adapter.dispose();
    };
    window.addEventListener("pagehide", leave);
    return () => {
      preserveRef.current();
      active.current = false;
      adapter.dispose();
      speech.current = null;
      window.removeEventListener("pagehide", leave);
    };
    // a Workspace instance is keyed by project+mode; callbacks read latest refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSource]);
  const payload: AudiencePayload = {
    projectId: project.id,
    slide: selected ? publicSlide(selected) : null,
    black,
    ended: false,
    timestamp: Date.now(),
  };
  useEffect(() => {
    publishAudience(payload);
  }, [project.id, selected, black]);
  useEffect(
    () => () => {
      publishAudience({
        projectId: project.id,
        slide: null,
        black: false,
        ended: true,
        timestamp: Date.now(),
      });
    },
    [project.id],
  );
  function preserveUnfinished() {
    const text = interimRef.current.trim();
    if (!text) return;
    const segment: TranscriptSegment = {
      id: uid(),
      slideId: utteranceSlide.current ?? selectionRef.current ?? "",
      text,
      start: utteranceStart.current,
      end: elapsedRef.current,
      provisional: true,
      inputSource: captureSession.current?.source,
      captureSessionId: captureSession.current?.id,
      capturedAt: Date.now(),
    };
    sessionTranscriptIds.current.add(segment.id);
    if (mode === "practice") practice.current.transcript.push(segment);
    mutateRef.current(
      {
        ...projectRef.current,
        transcript: [...projectRef.current.transcript, segment],
      },
      false,
    );
    interimRef.current = "";
    setInterim("");
    utteranceTarget.current = null;
    utteranceSlide.current = null;
    utteranceStart.current = elapsedRef.current;
  }
  preserveRef.current = preserveUnfinished;
  function navigate(n: number) {
    const s =
      projectRef.current.slides[
        Math.max(0, Math.min(projectRef.current.slides.length - 1, n))
      ];
    if (s) {
      preserveUnfinished();
      const resume =
        enabled &&
        !speechState.muted &&
        ["listening", "connecting"].includes(speechState.status);
      if (enabled) speech.current?.pause();
      setSelectedId(s.id);
      selectionRef.current = s.id;
      if (resume) speech.current?.resume();
      utteranceStart.current = elapsedRef.current;
    }
  }
  function finish() {
    settleTime();
    preserveUnfinished();
    speech.current?.stop();
    if (mode === "practice") {
      const rehearsal = buildRehearsal(
        practice.current.snapshot,
        [...practice.current.transcript],
        elapsedRef.current,
        projectRef.current.materials,
      );
      rehearsal.id = practice.current.id;
      coach.finish(rehearsal.id);
      mutate(
        {
          ...projectRef.current,
          rehearsals: [...projectRef.current.rehearsals, rehearsal].slice(-3),
        },
        false,
      );
      onMode("review");
    } else onMode("edit");
  }
  function openAppSettings(tab: SettingsTab = "connections") {
    preserveUnfinished();
    speech.current?.pause();
    coach.pause();
    setHeld(false);
    onAppSettings?.(tab);
  }
  function togglePause() {
    if (
      speechState.status === "listening" ||
      speechState.status === "connecting"
    ) {
      preserveUnfinished();
      speech.current?.pause();
    } else {
      if (mode === "practice") coach.resumePractice();
      speech.current?.resume();
    }
  }
  async function toggleFullscreen() {
    if (fullscreen) {
      setFullscreen(false);
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => {});
      return;
    }
    setFullscreen(true);
    await document.documentElement.requestFullscreen?.().catch(() => {});
  }
  useEffect(() => {
    const change = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isEditable(e.target) || hasOverlay() || audience) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === "z" &&
          ["edit", "create"].includes(mode)
        ) {
          e.preventDefault();
          undo();
        }
        return;
      }
      if (
        e.code === "Space" &&
        mode === "create" &&
        selected &&
        !e.repeat &&
        !(e.target as HTMLElement)?.closest("button,a")
      ) {
        e.preventDefault();
        setHeld(true);
        return;
      }
      if (e.key === "Escape") {
        if (fullscreen) {
          setFullscreen(false);
          return;
        }
        if (mode === "present" || mode === "practice") {
          e.preventDefault();
          finish();
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate(index - 1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate(index + 1);
      }
      if (e.key.toLowerCase() === "p" && enabled) togglePause();
      if (e.key.toLowerCase() === "m" && enabled)
        (() => {
          preserveUnfinished();
          speech.current?.setMuted(!speechState.muted);
        })();
      if (e.key.toLowerCase() === "a" && selected) setAudience(true);
      if (e.key.toLowerCase() === "f" && selected) void toggleFullscreen();
      if (e.key.toLowerCase() === "b" && mode === "present")
        setBlack((v) => !v);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setHeld(false);
    };
    const blur = () => {
      setHeld(false);
      setTarget("audience");
      if (enabled && voiceSource !== "phone") speech.current?.pause();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  });
  const voice = (
    <VoiceCapsule
      state={speechState}
      level={level}
      agent={target === "agent" || held}
      showTarget={mode === "create"}
      canTarget={Boolean(selected)}
      onPause={togglePause}
      onTarget={() => setTarget((v) => (v === "agent" ? "audience" : "agent"))}
      onMute={() => {
        preserveUnfinished();
        speech.current?.setMuted(!speechState.muted);
      }}
    />
  );
  if (mode === "review")
    return (
      <Review
        project={project}
        onChange={(p) => mutate(p, false)}
        onAgain={() => onMode("practice")}
        onPresent={() => onMode("present")}
        onDone={() => onMode("edit")}
      />
    );
  if (mode === "context")
    return (
      <div>
        <header className="workspace-header">
          <Button variant="ghost" onClick={() => onMode("edit")}>
            <ArrowLeft />
            Back to slides
          </Button>
          <h1 className="project-title">Project context</h1>
        </header>
        <section
          className="context-content"
          style={{ maxWidth: 800, margin: "32px auto" }}
        >
          <label className="field">
            Title
            <Input
              value={project.title}
              onChange={(e) => mutate({ ...project, title: e.target.value })}
            />
          </label>
          <label className="field">
            Description
            <Textarea
              value={project.description}
              onChange={(e) =>
                mutate({ ...project, description: e.target.value })
              }
            />
          </label>
          <label className="field">
            Slide instructions
            <Textarea
              value={project.systemPrompt}
              onChange={(e) =>
                mutate({ ...project, systemPrompt: e.target.value })
              }
            />
          </label>
          <Materials
            materials={project.materials}
            onChange={(materials) =>
              mutate({ ...projectRef.current, materials })
            }
          />
        </section>
      </div>
    );
  return (
    <>
      <div
        className={`workspace ${mode === "create" ? "talk" : mode === "practice" ? "practice" : ""} ${mode === "present" || mode === "practice" ? "present" : ""} ${(target === "agent" || held) && mode === "create" ? "agent-mode" : ""}`}
        inert={audience || fullscreen ? true : undefined}
      >
        <header className="workspace-header">
          <IconButton
            label="Back to projects"
            onClick={() => {
              preserveUnfinished();
              speech.current?.stop();
              onBack();
            }}
          >
            <ArrowLeft />
          </IconButton>
          <h1 className="project-title" title={project.title}>
            {project.title}
          </h1>
          {mode === "present" || mode === "practice" ? (
            <div className="header-end">
              <IconButton
                label="App settings"
                onClick={() => openAppSettings()}
              >
                <Settings />
              </IconButton>
              <span className="timer">{formatTime(elapsed)}</span>
              <IconButton
                label="Audience (A)"
                onClick={() => setAudience(true)}
              >
                <Monitor />
              </IconButton>
              <Button onClick={finish}>
                {mode === "practice" ? "Finish practice" : "End"}
              </Button>
            </div>
          ) : (
            <nav className="header-actions" aria-label="Presentation actions">
              {mode === "create" ? (
                <Button variant="primary" onClick={finish}>
                  <Check />
                  Finish
                </Button>
              ) : (
                <Button
                  variant="primary"
                  aria-label="Talk to generate"
                  onClick={() => onMode("create")}
                >
                  <Mic />
                  <span className="talk-label">
                    <span className="talk-full">Talk to generate</span>
                    <span className="talk-short" aria-hidden="true">
                      Talk
                    </span>
                  </span>
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={!selected}
                onClick={() => onMode("practice")}
                title="Practice"
              >
                <Timer />
                <span className="action-label">Practice</span>
              </Button>
              <Button
                variant="ghost"
                disabled={!selected}
                onClick={() => onMode("present")}
                title="Present"
              >
                <Presentation />
                <span className="action-label">Present</span>
              </Button>
              <span className="header-divider" />
              <IconButton
                label="Audience (A)"
                disabled={!selected}
                onClick={() => setAudience(true)}
              >
                <Monitor />
              </IconButton>
              <IconButton
                label="Project settings"
                onClick={() => setSettings(true)}
              >
                <SlidersHorizontal />
              </IconButton>
              <IconButton
                label="App settings"
                onClick={() => openAppSettings()}
              >
                <Settings />
              </IconButton>
              <Menu
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!selected || exporting}
                    aria-label="Export"
                    title="Export"
                  >
                    <Download />
                  </Button>
                }
              >
                {(["pptx", "pdf"] as const).map((format) => (
                  <MenuItem
                    key={format}
                    onSelect={() => {
                      setExporting(true);
                      exportProject(project, format)
                        .catch((e) => show(`Export failed: ${String(e)}`))
                        .finally(() => setExporting(false));
                    }}
                  >
                    {format === "pptx" ? "PowerPoint (.pptx)" : "PDF (.pdf)"}
                  </MenuItem>
                ))}
              </Menu>
              <IconButton
                label="Toggle sidebar"
                pressed={sidebar}
                onClick={() => setSidebar((v) => !v)}
              >
                {sidebar ? <PanelRightClose /> : <PanelRight />}
              </IconButton>
            </nav>
          )}
        </header>
        <div className="workspace-body">
          {mode === "present" || mode === "practice" ? (
            <>
              <div className="present-stage">
                {selected && (
                  <div className="slide-frame">
                    <SlideView slide={selected} />
                  </div>
                )}
              </div>
              <aside className="present-notes">
                {mode === "practice" && (
                  <PracticeCoach
                    controller={coach}
                    onPausePractice={() => {
                      preserveUnfinished();
                      speech.current?.pause();
                    }}
                    onResumePractice={() => speech.current?.resume()}
                    onSettings={() => openAppSettings("coach")}
                  />
                )}
                <div>
                  <span className="muted next-label">Next slide</span>
                  {project.slides[index + 1] ? (
                    <button
                      className="next-slide"
                      aria-label="Advance to next slide"
                      onClick={() => navigate(index + 1)}
                    >
                      <SlideView slide={project.slides[index + 1]} />
                    </button>
                  ) : (
                    <p className="muted">End of presentation</p>
                  )}
                </div>
                <div>
                  <h3 className="speaker-notes-heading">Speaker notes</h3>
                  <div
                    id="speaker-notes"
                    className="speaker-notes-readonly"
                    aria-label="Speaker notes"
                  >
                    {selected?.notes || "—"}
                  </div>
                  <details className="presenter-transcript" open>
                    <summary>Transcript</summary>
                    <Transcript
                      variant="presenter"
                      sessionIds={sessionTranscriptIds.current}
                      segments={
                        mode === "practice"
                          ? practice.current.transcript
                          : project.transcript
                      }
                      interim={interim}
                    />
                  </details>
                </div>
              </aside>
            </>
          ) : (
            <>
              <div
                className={`stage ${selected ? "" : "empty-stage"}`}
                ref={stage}
              >
                <div className="stage-fit">
                  <div
                    className={`slide-frame ${!selected ? "slide-empty" : ""}`}
                    ref={frame}
                    tabIndex={0}
                    aria-label="Slide canvas"
                  >
                    {selected ? (
                      <SlideView slide={selected} />
                    ) : (
                      <div className="empty-guide">
                        <h2>Start with an idea</h2>
                        <p>
                          Speak naturally. Your slides take shape as you talk.
                        </p>
                        <Button
                          variant="primary"
                          onClick={() =>
                            mode === "create"
                              ? speech.current?.retry()
                              : onMode("create")
                          }
                        >
                          Talk to generate
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {selected && (
                  <Annotations
                    slideId={`${project.id}:${selected.id}`}
                    stageRef={stage}
                    frameRef={frame}
                    disabled={audience || fullscreen}
                  />
                )}
                {enabled && interim && (
                  <p className="speech-status">{interim}</p>
                )}
                {enabled &&
                  (speechState.status === "error" ||
                    speechState.status === "unsupported") && (
                    <div className="speech-error" role="status">
                      <span>{speechState.message}</span>
                      {speechState.status !== "unsupported" && (
                        <Button onClick={() => speech.current?.retry()}>
                          Retry
                        </Button>
                      )}
                    </div>
                  )}
                {enabled && speechState.status === "connecting" && (
                  <div className="speech-status">
                    {speechState.message ??
                      "Connecting microphone… Allow access when prompted"}
                  </div>
                )}
              </div>
              {sidebar && (
                <aside
                  className="workspace-sidebar"
                  aria-label="Project sidebar"
                >
                  <Tabs value={tab} onValueChange={setTab}>
                    <TabsList className="tab-list">
                      <TabsTrigger className="tab-trigger" value="transcript">
                        Transcript
                      </TabsTrigger>
                      <TabsTrigger className="tab-trigger" value="context">
                        Context
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="transcript">
                      <Transcript
                        segments={project.transcript}
                        sessionIds={sessionTranscriptIds.current}
                        interim={interim}
                      />
                    </TabsContent>
                    <TabsContent value="context">
                      <div className="context-content">
                        <label className="field">
                          Slide instructions
                          <Textarea
                            maxLength={6000}
                            value={project.systemPrompt}
                            onChange={(e) =>
                              mutate({
                                ...project,
                                systemPrompt: e.target.value,
                              })
                            }
                          />
                        </label>
                        <Materials
                          materials={project.materials}
                          onChange={(materials) =>
                            mutate({ ...projectRef.current, materials })
                          }
                        />
                      </div>
                    </TabsContent>
                  </Tabs>
                </aside>
              )}
            </>
          )}
        </div>
        {mode === "present" || mode === "practice" ? (
          <footer className="present-controls">
            <IconButton
              label="Previous slide"
              disabled={index <= 0}
              onClick={() => navigate(index - 1)}
            >
              <ChevronLeft />
            </IconButton>
            <span className="muted">
              {index + 1} / {project.slides.length}
            </span>
            <IconButton
              label="Next slide"
              disabled={index >= project.slides.length - 1}
              onClick={() => navigate(index + 1)}
            >
              <ChevronRight />
            </IconButton>
            {voice}
            <IconButton
              label="Fullscreen (F)"
              onClick={() => void toggleFullscreen()}
            >
              <Maximize />
            </IconButton>
            {mode === "present" && (
              <Button
                variant="ghost"
                size="icon"
                className="blackout-control"
                aria-label={
                  black
                    ? "Restore audience screen (B)"
                    : "Black out audience screen (B)"
                }
                title={
                  black
                    ? "Restore audience screen (B)"
                    : "Black out audience screen (B)"
                }
                aria-pressed={black}
                onClick={() => setBlack((v) => !v)}
              >
                {black ? <MonitorCheck /> : <MonitorOff />}
              </Button>
            )}
            <span role="status" className="muted">
              {speechState.status === "listening"
                ? "Listening"
                : (speechState.message ?? speechState.status)}
            </span>
          </footer>
        ) : (
          <>
            <Filmstrip
              project={project}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onAdd={() => {
                const slide = blankSlide(projectRef.current.theme);
                const slides = [...projectRef.current.slides];
                const current = slides.findIndex(
                  (s) => s.id === selectionRef.current,
                );
                slides.splice(current + 1, 0, slide);
                mutate({ ...projectRef.current, slides });
                selectionRef.current = slide.id;
                setSelectedId(slide.id);
              }}
              onUndo={undo}
              canUndo={history.length > 0}
              onNavigate={() => {
                if (enabled) {
                  preserveUnfinished();
                  speech.current?.pause();
                  setHeld(false);
                }
              }}
            />
            {mode === "create" && (
              <footer className="voice-dock">{voice}</footer>
            )}
          </>
        )}
      </div>
      {audience && (
        <Audience
          projectId={project.id}
          payload={payload}
          onClose={() => setAudience(false)}
        />
      )}
      {fullscreen && (
        <div
          className="fullscreen-slide"
          onDoubleClick={() => void toggleFullscreen()}
        >
          {selected && (
            <div className="slide-frame">
              <SlideView slide={selected} />
            </div>
          )}
          <div className="audience-tools">
            <Button onClick={() => void toggleFullscreen()}>
              <ArrowLeft />
              Return
            </Button>
            <Button disabled={index <= 0} onClick={() => navigate(index - 1)}>
              <ChevronLeft />
            </Button>
            <Button
              disabled={index >= project.slides.length - 1}
              onClick={() => navigate(index + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
      <Modal
        open={settings}
        onOpenChange={setSettings}
        title="Project settings"
      >
        <label className="field">
          Title
          <Input
            maxLength={120}
            value={project.title}
            onChange={(e) => mutate({ ...project, title: e.target.value })}
          />
        </label>
        <label className="field">
          Description
          <Textarea
            maxLength={1600}
            value={project.description}
            onChange={(e) =>
              mutate({ ...project, description: e.target.value })
            }
          />
        </label>
        <label className="field">
          Slide instructions
          <Textarea
            maxLength={6000}
            value={project.systemPrompt}
            onChange={(e) =>
              mutate({ ...project, systemPrompt: e.target.value })
            }
          />
        </label>
        <div className="form-actions">
          <Button onClick={() => setSettings(false)}>Done</Button>
        </div>
      </Modal>
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
    </>
  );
}

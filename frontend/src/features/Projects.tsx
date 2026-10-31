import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, MoreHorizontal, Plus } from "lucide-react";
import { Button, Input, Menu, MenuItem, Textarea } from "../components/ui";
import { SlideView } from "../components/SlideView";
import { Materials } from "./Materials";
import type { Project, Workspace } from "../domain/types";
import { newProject, uid } from "../domain/types";
import { repository } from "../services/repository";
import "./projects.css";

export function Dashboard({
  workspace,
  onChange,
  onOpen,
  onNew,
}: {
  workspace: Workspace;
  onChange: (workspace: Workspace) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = useRef(workspace);
  current.current = workspace;
  async function duplicate(project: Project) {
    if (busy) return;
    setBusy(true);
    setError("");
    const stored: string[] = [];
    try {
      const copy = structuredClone(project);
      copy.id = uid();
      let n = 1;
      copy.title = `${project.title} copy`;
      while (
        current.current.projects.some(
          (p) => p.title.toLowerCase() === copy.title.toLowerCase(),
        )
      )
        copy.title = `${project.title} copy ${++n}`;
      copy.createdAt = copy.updatedAt = Date.now();
      copy.rehearsals = [];
      const materialIds = new Map<string, string>();
      for (const m of copy.materials) {
        const blob = await repository.getBlob(m.blobKey);
        if (!blob)
          throw Error(
            "An original source is missing. Add it again before duplicating.",
          );
        const old = m.id;
        m.id = uid();
        materialIds.set(old, m.id);
        m.blobKey = `source-${m.id}`;
        await repository.putBlob(m.blobKey, blob);
        stored.push(m.blobKey);
      }
      const slideIds = new Map<string, string>();
      for (const s of copy.slides) {
        const old = s.id;
        s.id = uid();
        slideIds.set(old, s.id);
        if (s.materialRef)
          s.materialRef.materialId =
            materialIds.get(s.materialRef.materialId) ||
            s.materialRef.materialId;
      }
      copy.transcript = copy.transcript.map((t) => ({
        ...t,
        id: uid(),
        slideId: slideIds.get(t.slideId) || t.slideId,
      }));
      onChange({
        ...current.current,
        projects: [...current.current.projects, copy],
      });
    } catch (e) {
      for (const key of stored)
        await repository.deleteBlob(key).catch(() => {});
      setError(
        e instanceof Error
          ? e.message
          : "Could not duplicate project. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const projects = [...workspace.projects].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  return (
    <div className="dashboard">
      <main className="dashboard-main">
        <div className="dashboard-content">
          <div className="dashboard-title-row">
            <h1>All projects</h1>
            <Button onClick={onNew}>
              <Plus />
              New project
            </Button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <section aria-label="Projects">
            <div className="project-section-heading">
              <h2>Projects</h2>
              <span className="muted">{projects.length}</span>
            </div>
            {projects.length ? (
              <div className="project-grid">
                {projects.map((project) => (
                  <article className="project-card" key={project.id}>
                    <button
                      className="project-card-open"
                      onClick={() => onOpen(project.id)}
                      aria-label={`Open ${project.title}`}
                    >
                      <div className="project-preview slide-frame">
                        {project.slides[0] ? (
                          <SlideView slide={project.slides[0]} />
                        ) : (
                          <div className="empty-project-preview">
                            <Plus />
                            <span>Empty presentation</span>
                          </div>
                        )}
                      </div>
                      <div className="project-card-copy">
                        <strong>{project.title}</strong>
                        <span className="muted">
                          {project.status === "ready" ? "Ready" : "Draft"}
                          <i>·</i>
                          {project.slides.length}{" "}
                          {project.slides.length === 1 ? "slide" : "slides"}
                          <i>·</i>Edited{" "}
                          {new Date(project.updatedAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                      </div>
                    </button>
                    <div className="project-card-menu">
                      <Menu
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Options for ${project.title}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        }
                      >
                        <MenuItem onSelect={() => onOpen(project.id)}>
                          Open project
                        </MenuItem>
                        <MenuItem
                          disabled={busy}
                          onSelect={() => void duplicate(project)}
                        >
                          <Copy />
                          Duplicate project
                        </MenuItem>
                      </Menu>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="projects-empty">
                <div className="projects-empty-icon">
                  <Plus />
                </div>
                <h2>No projects yet</h2>
                <p className="muted">
                  Start a presentation with your next idea.
                </p>
                <Button onClick={onNew}>
                  <Plus />
                  Create project
                </Button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export function ProjectSetup({
  workspace,
  onCreate,
  onCancel,
}: {
  workspace: Workspace;
  onCreate: (project: Project) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => newProject(workspace.projects)),
    [saving, setSaving] = useState(false),
    [analyzing, setAnalyzing] = useState(false),
    [error, setError] = useState("");
  const cleanup = useRef<Set<string>>(new Set()),
    success = useRef(false);
  const current = useRef(draft);
  current.current = draft;
  useEffect(
    () => () => {
      if (!success.current)
        for (const key of cleanup.current)
          void repository.deleteBlob(key).catch(() => {});
    },
    [],
  );
  async function create() {
    if (saving || analyzing) return;
    if (!draft.title.trim()) {
      setError("Enter a project title.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const used = new Set(draft.materials.map((m) => m.blobKey));
      success.current = true;
      await onCreate({ ...draft, title: draft.title.trim() });
      for (const key of cleanup.current)
        if (!used.has(key)) void repository.deleteBlob(key).catch(() => {});
    } catch {
      success.current = false;
      setError(
        "Could not create the project. Your details and sources are still here. Please try again.",
      );
      setSaving(false);
    }
  }
  return (
    <div className="project-setup">
      <header className="setup-header">
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={saving || analyzing}
        >
          <ArrowLeft />
          Projects
        </Button>
      </header>
      <main className="setup-content">
        <h1>New project</h1>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="setup-columns">
          <fieldset className="setup-details" disabled={saving}>
            <div className="setup-field">
              <label htmlFor="project-title">Title</label>
              <Input
                id="project-title"
                className="setup-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                maxLength={120}
                required
                autoFocus
              />
            </div>
            <div className="setup-field">
              <label htmlFor="project-description">
                Description <span className="muted">(optional)</span>
              </label>
              <Textarea
                id="project-description"
                rows={4}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                maxLength={1600}
                placeholder="What is your presentation about?"
              />
            </div>
          </fieldset>
          <div className="setup-materials">
            <Materials
              materials={draft.materials}
              disabled={saving}
              onBusyChange={setAnalyzing}
              onChange={(materials) => {
                for (const m of materials) cleanup.current.add(m.blobKey);
                setDraft({ ...current.current, materials });
              }}
            />
          </div>
        </div>
        <div className="setup-actions">
          <Button
            variant="primary"
            onClick={() => void create()}
            disabled={saving || analyzing}
          >
            {saving
              ? "Creating…"
              : analyzing
                ? "Analyzing sources…"
                : "Create project"}
          </Button>
        </div>
      </main>
    </div>
  );
}

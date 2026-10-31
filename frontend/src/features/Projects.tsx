import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder as FolderIcon,
  FolderOpen,
  Grid2X2,
  MoreHorizontal,
  Plus,
  Search,
  Speech,
  Settings,
} from "lucide-react";
import {
  Button,
  Input,
  Menu,
  MenuItem,
  Modal,
  Textarea,
} from "../components/ui";
import { SlideView } from "../components/SlideView";
import { Materials } from "./Materials";
import type { Folder, Project, Workspace } from "../domain/types";
import { newProject, uid } from "../domain/types";
import { repository } from "../services/repository";
import "./projects.css";

function pathTo(folders: Folder[], id: string | null): Folder[] {
  const path: Folder[] = [];
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const f = folders.find((f) => f.id === id);
    if (!f) break;
    path.unshift(f);
    id = f.parentId;
  }
  return path;
}
function Breadcrumb({
  folders,
  id,
  onSelect,
}: {
  folders: Folder[];
  id: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <nav className="project-breadcrumb" aria-label="Folder breadcrumb">
      <button type="button" onClick={() => onSelect(null)}>
        All projects
      </button>
      {pathTo(folders, id).map((f) => (
        <span key={f.id}>
          <ChevronRight />
          <button type="button" onClick={() => onSelect(f.id)}>
            {f.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
export function FolderPicker({
  folders,
  value,
  onChoose,
  open,
  onOpenChange,
}: {
  folders: Folder[];
  value: string | null;
  onChoose: (id: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [at, setAt] = useState(value),
    [query, setQuery] = useState("");
  useEffect(() => {
    if (open) {
      setAt(value);
      setQuery("");
    }
  }, [open, value]);
  const shown = query.trim()
    ? folders.filter((f) =>
        pathTo(folders, f.id)
          .map((f) => f.name)
          .join(" / ")
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : folders.filter((f) => f.parentId === at);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Choose folder"
      className="folder-picker"
    >
      <Input
        aria-label="Search folders"
        placeholder="Search folders…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Breadcrumb
        folders={folders}
        id={at}
        onSelect={(id) => {
          setAt(id);
          setQuery("");
        }}
      />
      <div className="folder-destinations">
        {shown.map((f) => (
          <button
            type="button"
            key={f.id}
            onClick={() => {
              setAt(f.id);
              setQuery("");
            }}
          >
            <FolderIcon />
            <span>
              {f.name}
              {query && (
                <small>
                  {pathTo(folders, f.parentId)
                    .map((p) => p.name)
                    .join(" / ") || "All projects"}
                </small>
              )}
            </span>
            <ChevronRight />
          </button>
        ))}
        {shown.length === 0 && (
          <p className="muted">
            {query ? "No folders match your search." : "No subfolders"}
          </p>
        )}
      </div>
      <div className="project-dialog-actions">
        <Button type="button" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            onChoose(at);
            onOpenChange(false);
          }}
        >
          <Check />
          {at ? "Use this folder" : "Use no folder"}
        </Button>
      </div>
    </Modal>
  );
}
interface DashboardProps {
  onAppSettings?: () => void;
  workspace: Workspace;
  onChange: (workspace: Workspace) => void;
  onOpen: (id: string) => void;
  onNew: (folderId: string | null) => void;
  folderId: string | null;
  onFolder: (id: string | null) => void;
}
export function Dashboard({
  workspace,
  onChange,
  onOpen,
  onNew,
  folderId,
  onFolder,
  onAppSettings,
}: DashboardProps) {
  const [query, setQuery] = useState(""),
    [collapsed, setCollapsed] = useState<Set<string>>(() => {
      try {
        return new Set(
          JSON.parse(
            localStorage.getItem("talkdeck-collapsed-folders") || "[]",
          ) as string[],
        );
      } catch {
        return new Set();
      }
    }),
    [folderEdit, setFolderEdit] = useState<{
      parentId: string | null;
      folder?: Folder;
    } | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [folderError, setFolderError] = useState(""),
    [move, setMove] = useState<Project | null>(null),
    [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null),
    tree = useRef<HTMLDivElement>(null),
    current = useRef(workspace);
  current.current = workspace;
  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const editable =
        target.matches("input,textarea,select") || target.isContentEditable;
      const dialog = !!document.querySelector('[role="dialog"], [role="menu"]');
      if (
        !dialog &&
        ((e.key === "/" && !editable) ||
          ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"))
      ) {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    setQuery("");
    setCollapsed((old) => {
      const next = new Set(old);
      for (const f of pathTo(workspace.folders, folderId)) next.delete(f.id);
      return next;
    });
  }, [folderId, workspace.folders]);
  function toggle(id: string) {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(
          "talkdeck-collapsed-folders",
          JSON.stringify([...next]),
        );
      } catch {
        /* UI preference is optional. */
      }
      return next;
    });
  }
  const visible = useMemo(() => {
    const rows: { folder: Folder; depth: number }[] = [];
    const seen = new Set<string>();
    function walk(parent: string | null, depth: number) {
      for (const f of workspace.folders.filter((f) => f.parentId === parent)) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        rows.push({ folder: f, depth });
        if (!collapsed.has(f.id)) walk(f.id, depth + 1);
      }
    }
    walk(null, 0);
    return rows;
  }, [workspace.folders, collapsed]);
  function treeKey(e: KeyboardEvent<HTMLDivElement>, f: Folder) {
    if ((e.target as HTMLElement).closest("button")) return;
    const rows = Array.from(
        tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') || [],
      ),
      index = rows.findIndex((r) => r.dataset.id === f.id);
    let next: number | undefined;
    const children = workspace.folders.filter((c) => c.parentId === f.id);
    if (e.key === "ArrowDown") next = Math.min(index + 1, rows.length - 1);
    if (e.key === "ArrowUp") next = Math.max(index - 1, 0);
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = rows.length - 1;
    if (e.key === "ArrowRight") {
      if (children.length && collapsed.has(f.id)) toggle(f.id);
      else if (children.length) next = index + 1;
    }
    if (e.key === "ArrowLeft") {
      if (children.length && !collapsed.has(f.id)) toggle(f.id);
      else next = rows.findIndex((r) => r.dataset.id === f.parentId);
    }
    if (["Enter", " "].includes(e.key)) onFolder(f.id);
    if (
      [
        "ArrowDown",
        "ArrowUp",
        "Home",
        "End",
        "ArrowRight",
        "ArrowLeft",
        "Enter",
        " ",
      ].includes(e.key)
    ) {
      e.preventDefault();
      if (next !== undefined && next >= 0) rows[next]?.focus();
    }
  }
  function editFolder(parentId: string | null, folder?: Folder) {
    setFolderEdit({ parentId, folder });
    setName(folder?.name || "");
    setFolderError("");
  }
  function saveFolder() {
    if (!folderEdit) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setFolderError("Enter a folder name.");
      return;
    }
    if (
      workspace.folders.some(
        (f) =>
          f.parentId === folderEdit.parentId &&
          f.id !== folderEdit.folder?.id &&
          f.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      setFolderError("A folder with this name already exists here.");
      return;
    }
    const folders = folderEdit.folder
      ? workspace.folders.map((f) =>
          f.id === folderEdit.folder!.id ? { ...f, name: trimmed } : f,
        )
      : [
          ...workspace.folders,
          { id: uid(), name: trimmed, parentId: folderEdit.parentId },
        ];
    onChange({ ...workspace, folders });
    if (folderEdit.parentId)
      setCollapsed((old) => {
        const next = new Set(old);
        next.delete(folderEdit.parentId!);
        return next;
      });
    setFolderError("");
    setFolderEdit(null);
  }
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
  const projects = workspace.projects
      .filter(
        (p) =>
          (folderId === null || p.folderId === folderId) &&
          `${p.title} ${p.description}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt),
    folders = workspace.folders.filter((f) => f.parentId === folderId),
    selected = workspace.folders.find((f) => f.id === folderId);
  function folderMenu(f: Folder) {
    return (
      <Menu
        trigger={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Options for ${f.name}`}
          >
            <MoreHorizontal />
          </Button>
        }
      >
        <MenuItem onSelect={() => onFolder(f.id)}>Open folder</MenuItem>
        <MenuItem onSelect={() => onNew(f.id)}>New project</MenuItem>
        <MenuItem onSelect={() => editFolder(f.id)}>New subfolder</MenuItem>
        <MenuItem onSelect={() => editFolder(f.parentId, f)}>
          Rename folder
        </MenuItem>
      </Menu>
    );
  }
  return (
    <div className="dashboard">
      <aside className="project-sidebar">
        <button className="talkdeck-wordmark" onClick={() => onFolder(null)}>
          <Speech />
          Talkdeck
        </button>
        <button
          className={`all-projects ${folderId === null ? "is-selected" : ""}`}
          onClick={() => onFolder(null)}
        >
          <Grid2X2 />
          All projects<span>{workspace.projects.length}</span>
        </button>
        <div className="folder-tree-heading">
          <span>Folders</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="New folder"
            onClick={() => editFolder(null)}
          >
            <Plus />
          </Button>
        </div>
        <div
          className="folder-tree"
          ref={tree}
          role="tree"
          aria-label="Project folders"
        >
          {visible.map(({ folder: f, depth }) => {
            const hasChildren = workspace.folders.some(
                (c) => c.parentId === f.id,
              ),
              expanded = !collapsed.has(f.id);
            return (
              <div
                className={`folder-tree-row ${folderId === f.id ? "is-selected" : ""}`}
                key={f.id}
                role="treeitem"
                tabIndex={0}
                aria-selected={folderId === f.id}
                aria-level={depth + 1}
                aria-expanded={hasChildren ? expanded : undefined}
                data-id={f.id}
                style={{ paddingLeft: 8 + depth * 18 }}
                onKeyDown={(e) => treeKey(e, f)}
                onClick={() => onFolder(f.id)}
              >
                <button
                  className="folder-chevron"
                  tabIndex={-1}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${f.name}`}
                  disabled={!hasChildren}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(f.id);
                  }}
                >
                  {hasChildren &&
                    (expanded ? <ChevronDown /> : <ChevronRight />)}
                </button>
                {folderId === f.id ? <FolderOpen /> : <FolderIcon />}
                <span className="folder-tree-name">{f.name}</span>
                <button
                  className="folder-add"
                  aria-label={`New subfolder in ${f.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    editFolder(f.id);
                  }}
                >
                  <Plus />
                </button>
              </div>
            );
          })}
          {!visible.length && (
            <p className="folder-tree-empty muted">
              Organize projects into folders.
            </p>
          )}
        </div>
        <div className="app-settings-footer">
          <Button variant="ghost" onClick={onAppSettings}>
            <Settings />
            App settings
          </Button>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="project-search-header">
          <div className="project-search">
            <Search />
            <Input
              ref={search}
              placeholder="Search projects…"
              aria-label="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
        </header>
        <div className="dashboard-content">
          {folderId && (
            <Breadcrumb
              folders={workspace.folders}
              id={folderId}
              onSelect={onFolder}
            />
          )}
          <div className="dashboard-title-row">
            <h1>{selected?.name || "All projects"}</h1>
            <Button variant="primary" onClick={() => onNew(folderId)}>
              <Plus />
              New project
            </Button>
          </div>
          {error && !folderEdit && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!query && folders.length > 0 && (
            <section className="dashboard-folder-section" aria-label="Folders">
              <h2>Folders</h2>
              <div className="folder-grid">
                {folders.map((f) => (
                  <article className="folder-card" key={f.id}>
                    <button
                      className="folder-card-open"
                      onClick={() => onFolder(f.id)}
                    >
                      <FolderIcon />
                      <span>{f.name}</span>
                    </button>
                    {folderMenu(f)}
                  </article>
                ))}
              </div>
            </section>
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
                        <MenuItem onSelect={() => setMove(project)}>
                          <FolderIcon />
                          Move to folder
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
                  {query ? <Search /> : <PresentationEmpty />}
                </div>
                <h2>{query ? "No matching projects" : "No projects yet"}</h2>
                <p className="muted">
                  {query
                    ? "Try another title or description."
                    : "Start a presentation with your next idea."}
                </p>
                {!query && (
                  <Button variant="primary" onClick={() => onNew(folderId)}>
                    <Plus />
                    Create project
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
      <Modal
        open={!!folderEdit}
        onOpenChange={(v) => {
          if (!v) {
            setFolderError("");
            setFolderEdit(null);
          }
        }}
        title={folderEdit?.folder ? "Rename folder" : "New folder"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveFolder();
          }}
        >
          <label className="project-field-label" htmlFor="folder-name">
            Folder name
          </label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFolderError("");
            }}
            maxLength={80}
            autoFocus
          />
          {folderError && (
            <p className="form-error" role="alert">
              {folderError}
            </p>
          )}
          <div className="project-dialog-actions">
            <Button
              type="button"
              onClick={() => {
                setFolderError("");
                setFolderEdit(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              {folderEdit?.folder ? "Save name" : "Create folder"}
            </Button>
          </div>
        </form>
      </Modal>
      <FolderPicker
        folders={workspace.folders}
        value={move?.folderId || null}
        open={!!move}
        onOpenChange={(v) => {
          if (!v) setMove(null);
        }}
        onChoose={(id) => {
          if (move)
            onChange({
              ...workspace,
              projects: workspace.projects.map((p) =>
                p.id === move.id
                  ? { ...p, folderId: id, updatedAt: Date.now() }
                  : p,
              ),
            });
        }}
      />
    </div>
  );
}
function PresentationEmpty() {
  return <Speech />;
}

export function ProjectSetup({
  workspace,
  folderId,
  onCreate,
  onCancel,
}: {
  workspace: Workspace;
  folderId: string | null;
  onCreate: (project: Project) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() =>
      newProject(workspace.projects, folderId),
    ),
    [picker, setPicker] = useState(false),
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
            <details className="setup-instructions">
              <summary>
                Slide instructions
                <ChevronDown />
              </summary>
              <div className="setup-field">
                <label htmlFor="system-prompt">Instructions</label>
                <Textarea
                  id="system-prompt"
                  rows={7}
                  value={draft.systemPrompt}
                  onChange={(e) =>
                    setDraft({ ...draft, systemPrompt: e.target.value })
                  }
                  maxLength={6000}
                />
              </div>
            </details>
            <div className="setup-field">
              <label>Folder</label>
              <button
                className="setup-folder"
                type="button"
                onClick={() => setPicker(true)}
              >
                <FolderIcon />
                <span>
                  {pathTo(workspace.folders, draft.folderId)
                    .map((f) => f.name)
                    .join(" / ") || "No folder"}
                </span>
                <span className="muted">Browse</span>
                <ChevronRight />
              </button>
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
      </main>
      <FolderPicker
        folders={workspace.folders}
        value={draft.folderId}
        onChoose={(id) => setDraft({ ...draft, folderId: id })}
        open={picker}
        onOpenChange={setPicker}
      />
    </div>
  );
}

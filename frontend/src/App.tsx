import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui";
import { Audience } from "./components/Audience";
import { Dashboard, ProjectSetup } from "./features/Projects";
import { Workspace as WorkspaceScreen, type Mode } from "./features/Workspace";
import { repository } from "./services/repository";
import { GlobalSettings, type SettingsTab } from "./features/GlobalSettings";
import { initializeConnections } from "./services/connectionsBootstrap";
import { PhoneSender } from "./features/PhoneVoice";
import { type Project, type Workspace } from "./domain/types";
const go = (hash: string) => {
  location.hash = hash;
};
export default function App() {
  const [appSettings, setAppSettings] = useState<SettingsTab | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [loadError, setLoadError] = useState(""),
    [saveError, setSaveError] = useState(""),
    [hash, setHash] = useState(location.hash || "#folder/all");
  const inputIntent = useRef<string | null>(null);
  const phoneRoute = hash.split("?")[0] === "#phone";
  useEffect(() => {
    if (!location.pathname.endsWith("audience.html"))
      void initializeConnections(phoneRoute ? "sender" : "receiver");
  }, [phoneRoute]);
  const latest = useRef<Workspace | null>(null),
    lastSaved = useRef<Workspace | null>(null),
    pending = useRef<Promise<void>>(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = (w: Workspace) => {
    pending.current = pending.current
      .catch(() => {})
      .then(() => repository.save(w))
      .then(() => {
        lastSaved.current = w;
        if (latest.current === w) setSaveError("");
      })
      .catch((e) => {
        setSaveError(
          `Changes are not saved. ${e instanceof Error ? e.message : String(e)}`,
        );
        throw e;
      });
    pending.current.catch(() => {});
    return pending.current;
  };
  const load = () => {
    setLoadError("");
    repository
      .load()
      .then((w) => {
        latest.current = w;
        lastSaved.current = w;
        setWorkspace(w);
      })
      .catch((e) => setLoadError(String(e)));
  };
  useEffect(() => {
    load();
    const navigate = () => {
      if (inputIntent.current && inputIntent.current !== location.hash)
        inputIntent.current = null;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        if (latest.current) void persist(latest.current).catch(() => {});
      }
      setHash(location.hash || "#folder/all");
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (latest.current !== lastSaved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const hide = () => {
      // Speech pagehide cleanup can synchronously add a final provisional segment.
      queueMicrotask(() => {
        if (latest.current !== lastSaved.current && latest.current)
          void persist(latest.current).catch(() => {});
      });
    };
    window.addEventListener("hashchange", navigate);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("hashchange", navigate);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("pagehide", hide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const criticalKey = (w: Workspace | null) =>
    JSON.stringify(
      w && {
        folders: w.folders,
        projects: w.projects.map((p) => ({
          id: p.id,
          folderId: p.folderId,
          theme: p.theme,
          slides: p.slides.map((s) => s.id),
          materials: p.materials.map((m) => m.id),
          transcript: p.transcript.length,
          rehearsals: p.rehearsals.map((r) => ({
            id: r.id,
            completedAt: r.completedAt,
            decisions: r.proposals.map((p) => p.status),
          })),
        })),
      },
    );
  const change = (w: Workspace) => {
    const critical = criticalKey(w) !== criticalKey(latest.current);
    setWorkspace(w);
    latest.current = w;
    if (timer.current) clearTimeout(timer.current);
    if (critical) {
      timer.current = null;
      void persist(w).catch(() => {});
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      void persist(w).catch(() => {});
    }, 300);
  };
  const updateProject = (p: Project) => {
    const w = latest.current;
    if (w)
      change({
        ...w,
        projects: w.projects.map((old) => (old.id === p.id ? p : old)),
      });
  };
  if (location.pathname.endsWith("audience.html"))
    return (
      <Audience
        projectId={new URLSearchParams(location.search).get("project") ?? ""}
      />
    );
  if (hash.split("?")[0] === "#phone") return <PhoneSender />;
  if (loadError)
    return (
      <main className="loading-page">
        <h1>Unable to load your workspace</h1>
        <p role="alert">{loadError}</p>
        <Button onClick={load}>Try again</Button>
      </main>
    );
  if (!workspace)
    return (
      <main className="loading-page" role="status">
        Loading workspace…
      </main>
    );
  const parts = hash.slice(1).split("/"),
    kind = parts[0],
    id = parts[1];
  let content;
  if (kind === "project") {
    const project = workspace.projects.find((p) => p.id === id);
    const mode = (
      ["edit", "create", "present", "practice", "review", "context"].includes(
        parts[2],
      )
        ? parts[2]
        : "edit"
    ) as Mode;
    if (project)
      content = (
        <WorkspaceScreen
          key={`${project.id}:${mode}`}
          project={project}
          mode={mode}
          onChange={updateProject}
          onMode={(m) => {
            const route = `#project/${project.id}/${m}`;
            inputIntent.current = ["create", "practice", "present"].includes(m)
              ? route
              : null;
            go(route);
          }}
          claimInputStart={() => {
            const allowed = inputIntent.current === hash;
            inputIntent.current = null;
            return allowed;
          }}
          onBack={() => go("#folder/all")}
          speechSuspended={Boolean(appSettings)}
          onAppSettings={(tab) => setAppSettings(tab ?? "connections")}
        />
      );
    else {
      queueMicrotask(() => go("#folder/all"));
      content = <div role="status">Returning to projects…</div>;
    }
  } else if (kind === "new")
    content = (
      <ProjectSetup
        key={hash}
        workspace={workspace}
        folderId={id === "all" ? null : (id ?? null)}
        onCancel={() => go("#folder/all")}
        onCreate={async (project) => {
          const w = {
            ...latest.current!,
            projects: [...latest.current!.projects, project],
          };
          await persist(w);
          latest.current = w;
          setWorkspace(w);
          go(`#project/${project.id}/edit`);
        }}
      />
    );
  else
    content = (
      <Dashboard
        workspace={workspace}
        folderId={id === "all" || kind !== "folder" ? null : (id ?? null)}
        onFolder={(folderId) => go(`#folder/${folderId ?? "all"}`)}
        onChange={change}
        onOpen={(projectId) => go(`#project/${projectId}/edit`)}
        onNew={(folderId) => go(`#new/${folderId ?? "all"}`)}
        onAppSettings={() => setAppSettings("connections")}
      />
    );
  return (
    <>
      {saveError && (
        <div className="error-banner" role="alert">
          {saveError}
          <Button
            onClick={() =>
              latest.current && void persist(latest.current).catch(() => {})
            }
          >
            Retry save
          </Button>
        </div>
      )}
      {content}
      {appSettings && (
        <GlobalSettings
          open
          initialTab={appSettings}
          onOpenChange={(open) => {
            if (!open) setAppSettings(null);
          }}
          returnLabel={
            kind === "project" ? "Back to presentation" : "Back to projects"
          }
        />
      )}
    </>
  );
}

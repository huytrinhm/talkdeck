import { useEffect, useRef, useState } from "react";
import {
  Archive,
  AudioLines,
  Code,
  Download,
  File as FileIcon,
  FileImage,
  FileText,
  Film,
  Plus,
  Presentation,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Button,
  Input,
  Menu,
  MenuItem,
  Modal,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Textarea,
} from "../components/ui";
import type { Material } from "../domain/types";
import { analyzeMaterial, formatBytes } from "../domain/materials";
import { repository } from "../services/repository";
import "./materials.css";

function SourceIcon({ material }: { material: Material }) {
  const kind = material.type,
    name = material.name;
  const Icon =
    material.tables?.length || /\.(csv|xlsx?|ods)$/i.test(name)
      ? Table2
      : kind.startsWith("image/")
        ? FileImage
        : kind.startsWith("audio/")
          ? AudioLines
          : kind.startsWith("video/")
            ? Film
            : /\.(pptx?|key|odp)$/i.test(name)
              ? Presentation
              : /\.(zip|gz|tar|7z|rar)$/i.test(name)
                ? Archive
                : /\.(js|tsx?|jsx|py|sql|html|css|json|xml)$/i.test(name)
                  ? Code
                  : material.text !== undefined
                    ? FileText
                    : FileIcon;
  return <Icon aria-hidden="true" />;
}
export function Materials({
  materials,
  onChange,
  onBusyChange,
  disabled = false,
}: {
  materials: Material[];
  onChange: (materials: Material[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState("files"),
    [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<Material | null>(null),
    [previewUrl, setPreviewUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null),
    latest = useRef(materials);
  latest.current = materials;
  useEffect(() => {
    let active = true;
    let url = "";
    setPreviewUrl("");
    if (preview?.type.startsWith("image/"))
      void repository
        .getBlob(preview.blobKey)
        .then((blob) => {
          if (blob && active) {
            url = URL.createObjectURL(blob);
            setPreviewUrl(url);
          }
        })
        .catch(() => {
          if (active) setError("The original source could not be loaded.");
        });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);
  async function addFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    const added: Material[] = [];
    try {
      for (const file of files) {
        const material = await analyzeMaterial(file);
        await repository.putBlob(material.blobKey, file);
        added.push(material);
      }
      onChange([...latest.current, ...added]);
      setOpen(false);
      setText("");
      setTitle("");
    } catch {
      for (const material of added)
        await repository.deleteBlob(material.blobKey).catch(() => {});
      setError(
        "Could not save these sources. Your existing sources are unchanged. Try again or free browser storage.",
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function download(material: Material) {
    try {
      const blob = await repository.getBlob(material.blobKey);
      if (!blob) throw Error();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = material.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(
        "The original source is unavailable. Please add the file again.",
      );
    }
  }
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <section className="materials" aria-label="Sources">
      <div className="materials-heading">
        <h3>Materials</h3>
        <Button
          className="add-sources"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
          disabled={busy || disabled}
        >
          <Plus />
          Add sources
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {materials.length === 0 ? (
        <p className="materials-empty muted">
          Add files or copied text to give your presentation context.
        </p>
      ) : (
        <ul className="source-list">
          {materials.map((material) => (
            <li key={material.id} className="source-row">
              <button
                type="button"
                className="source-open"
                onClick={() => setPreview(material)}
              >
                <SourceIcon material={material} />
                <span>
                  <strong title={material.name}>{material.name}</strong>
                  <small>
                    {formatBytes(material.size)} ·{" "}
                    {material.status === "ready"
                      ? material.tables?.length
                        ? `${material.tables.length} ${material.tables.length === 1 ? "table" : "tables"} ready`
                        : "Text ready"
                      : material.status === "error"
                        ? "Could not analyze"
                        : "Reference file"}
                  </small>
                </span>
              </button>
              <Menu
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={`Options for ${material.name}`}
                  >
                    <span aria-hidden="true">⋯</span>
                  </Button>
                }
              >
                <MenuItem onSelect={() => setPreview(material)}>
                  Preview
                </MenuItem>
                <MenuItem onSelect={() => void download(material)}>
                  <Download />
                  Download original
                </MenuItem>
                <MenuItem
                  onSelect={() =>
                    onChange(materials.filter((m) => m.id !== material.id))
                  }
                >
                  <Trash2 />
                  Remove source
                </MenuItem>
              </Menu>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
        title="Add sources"
        className="source-dialog"
      >
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="source-tabs" aria-label="Source type">
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="text">Copied text</TabsTrigger>
          </TabsList>
          <TabsContent value="files">
            <input
              type="file"
              multiple
              ref={fileInput}
              hidden
              aria-label="Choose source files"
              onChange={(e) => void addFiles(Array.from(e.target.files || []))}
            />
            <div
              className="source-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) void addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload />
              <p>Drop files here</p>
              <p className="muted">Documents, spreadsheets, images, and more</p>
              <Button
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {busy ? "Analyzing sources…" : "Choose files"}
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="text">
            <div className="source-text-editor">
              <label htmlFor="source-title">
                Title <span className="muted">(optional)</span>
              </label>
              <Input
                id="source-title"
                className="source-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled source"
                maxLength={180}
                disabled={busy}
              />
              <label htmlFor="source-text">Source text</label>
              <Textarea
                id="source-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste your notes, research, or reference text…"
                className="source-code"
                disabled={busy}
              />
              <div className="source-editor-footer">
                <span className="muted">
                  {words.toLocaleString()} {words === 1 ? "word" : "words"}
                </span>
                <Button
                  variant="primary"
                  disabled={!text.trim() || busy}
                  onClick={() =>
                    void addFiles([
                      new File(
                        [text],
                        `${title.trim().replace(/\.txt$/i, "") || "Untitled source"}.txt`,
                        { type: "text/plain" },
                      ),
                    ])
                  }
                >
                  {busy ? "Saving…" : "Add source"}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </Modal>
      <Modal
        open={!!preview}
        onOpenChange={(v) => {
          if (!v) setPreview(null);
        }}
        title={preview?.name || "Source preview"}
        className="source-preview-dialog"
      >
        {preview && (
          <>
            <p className="muted">
              {formatBytes(preview.size)} ·{" "}
              {preview.tables?.length
                ? "Prepared table data"
                : preview.text !== undefined
                  ? "Text source"
                  : "Reference file"}
            </p>
            {preview.tables?.map((table, i) => (
              <div key={`${table.name}-${i}`} className="source-table-preview">
                <h3>{table.name}</h3>
                <div className="source-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {table.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.slice(0, 100).map((r, ri) => (
                        <tr key={ri}>
                          {r.map((c, ci) => (
                            <td key={ci}>{c === null ? "null" : String(c)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {table.rows.length > 100 && (
                  <p className="muted">
                    Showing 100 of {table.rows.length.toLocaleString()} rows.
                    Download the original for all data.
                  </p>
                )}
              </div>
            ))}
            {preview.text !== undefined && (
              <>
                <pre className="source-code source-readonly">
                  {preview.text.slice(0, 30000)}
                </pre>
                {preview.text.length > 30000 && (
                  <p className="muted">
                    Preview limited to 30,000 characters. The original is
                    complete.
                  </p>
                )}
              </>
            )}
            {previewUrl && (
              <img
                className="source-image"
                src={previewUrl}
                alt={preview.name}
              />
            )}{" "}
            {!preview.tables?.length &&
              preview.text === undefined &&
              !preview.type.startsWith("image/") && (
                <p className="material-reference-message">
                  Preview is unavailable for this format. The original file is
                  preserved.
                </p>
              )}
            <div className="source-editor-footer">
              <span />
              <Button onClick={() => void download(preview)}>
                <Download />
                Download original
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}

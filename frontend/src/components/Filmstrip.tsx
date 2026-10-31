import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Plus,
  Copy,
  Clipboard,
  Scissors,
  Trash2,
  Undo2,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { Button } from "./ui";
import { SlideView } from "./SlideView";
import type { Project, Slide } from "../domain/types";
import { slideOperation } from "../domain/commands";
export function dispatchSlideShortcut(operation: "copy" | "cut" | "paste") {
  window.dispatchEvent(
    new CustomEvent("talkdeck-slide-operation", { detail: operation }),
  );
}
let clipboard: { projectId: string; slide: Slide } | undefined;
export function Filmstrip({
  project,
  selectedId,
  onSelect,
  onChange,
  onUndo,
  canUndo,
  onNavigate,
}: {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (p: Project) => void;
  onUndo: () => void;
  canUndo: boolean;
  onNavigate?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    focusNext = useRef(false),
    drag = useRef<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const [clipVersion, setClipVersion] = useState(0);
  const index = project.slides.findIndex((s) => s.id === selectedId);
  useLayoutEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    const el = ref.current?.querySelector<HTMLElement>(
      `[data-id="${selectedId ?? "add"}"]`,
    );
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId, project.slides]);
  function op(
    operation: Parameters<typeof slideOperation>[2],
    id = selectedId,
  ) {
    focusNext.current = true;
    const result = slideOperation(project, id, operation, clipboard);
    if (result.clipboard) {
      clipboard = result.clipboard;
      setClipVersion(clipVersion + 1);
    }
    onChange(result.project);
    onSelect(result.selectedId);
  }
  const shortcutRef = useRef(op);
  shortcutRef.current = op;
  useEffect(() => {
    const handler = (event: Event) =>
      shortcutRef.current((event as CustomEvent).detail);
    window.addEventListener("talkdeck-slide-operation", handler);
    return () =>
      window.removeEventListener("talkdeck-slide-operation", handler);
  }, []);
  const choose = (id: string) => {
    onNavigate?.();
    onSelect(id);
    focusNext.current = true;
  };
  const items = [
    ["add-before", "Add slide before", Plus, ""],
    ["add-after", "Add slide after", Plus, ""],
    ["copy", "Copy", Copy, "⌘C"],
    ["cut", "Cut", Scissors, "⌘X"],
    ["paste", "Paste after", Clipboard, "⌘V"],
    ["duplicate", "Duplicate", Copy, ""],
    ["delete", "Delete", Trash2, "⌫"],
    ["move-left", "Move earlier", ArrowLeft, "Alt ←"],
    ["move-right", "Move later", ArrowRight, "Alt →"],
  ] as const;
  return (
    <div
      className="filmstrip"
      aria-label="Slides"
      ref={ref}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest("[data-id]")) return;
        const cmd = e.ctrlKey || e.metaKey;
        let action: Parameters<typeof slideOperation>[2] | undefined;
        if (cmd && e.key.toLowerCase() === "c") action = "copy";
        if (cmd && e.key.toLowerCase() === "x") action = "cut";
        if (cmd && e.key.toLowerCase() === "v") action = "paste";
        if (e.key === "Delete" || e.key === "Backspace") action = "delete";
        if (e.altKey && e.key === "ArrowLeft") action = "move-left";
        if (e.altKey && e.key === "ArrowRight") action = "move-right";
        if (cmd && e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.stopPropagation();
          onUndo();
          focusNext.current = true;
          return;
        }
        if (action) {
          e.preventDefault();
          e.stopPropagation();
          op(action);
          return;
        }
        if (e.key === "F10" && e.shiftKey) {
          e.preventDefault();
          const b = t.getBoundingClientRect();
          t.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              clientX: b.left + 10,
              clientY: b.top + 10,
            }),
          );
          return;
        }
        if (
          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) &&
          !e.altKey
        ) {
          e.preventDefault();
          e.stopPropagation();
          const n =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? project.slides.length - 1
                : Math.max(
                    0,
                    Math.min(
                      project.slides.length - 1,
                      index + (e.key === "ArrowRight" ? 1 : -1),
                    ),
                  );
          if (project.slides[n]) choose(project.slides[n].id);
        }
      }}
    >
      {project.slides.map((slide, i) => (
        <ContextMenu.Root key={slide.id}>
          <ContextMenu.Trigger asChild>
            <button
              data-id={slide.id}
              draggable
              className={`filmstrip-thumbnail ${over?.id === slide.id ? (over.after ? "drop-after" : "drop-before") : ""}`}
              aria-label={`Slide ${i + 1}: ${slide.title}`}
              aria-current={slide.id === selectedId}
              onClick={() => choose(slide.id)}
              onContextMenu={() => onSelect(slide.id)}
              onDragStart={(e) => {
                drag.current = slide.id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", slide.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setOver({
                  id: slide.id,
                  after: e.clientX > r.left + r.width / 2,
                });
                const host = ref.current;
                if (host) {
                  const h = host.getBoundingClientRect();
                  if (e.clientX < h.left + 50) host.scrollLeft -= 20;
                  if (e.clientX > h.right - 50) host.scrollLeft += 20;
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const source = project.slides.find(
                  (s) => s.id === drag.current,
                );
                if (source && source.id !== slide.id) {
                  const slides = project.slides.filter(
                    (s) => s.id !== source.id,
                  );
                  const target =
                    slides.findIndex((s) => s.id === slide.id) +
                    (over?.after ? 1 : 0);
                  slides.splice(target, 0, source);
                  onChange({ ...project, slides });
                  focusNext.current = true;
                }
                drag.current = null;
                setOver(null);
              }}
              onDragEnd={() => {
                drag.current = null;
                setOver(null);
              }}
            >
              <SlideView slide={slide} />
              <span className="filmstrip-number">
                {String(i + 1).padStart(2, "0")}
              </span>
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content
              className="menu"
              collisionPadding={8}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                focusNext.current = true;
                ref.current
                  ?.querySelector<HTMLElement>(
                    `[data-id="${selectedId ?? "add"}"]`,
                  )
                  ?.focus();
              }}
            >
              {items.map(([key, label, Icon, hint]) => (
                <ContextMenu.Item
                  className="menu-item"
                  key={key}
                  disabled={
                    (key === "paste" && !clipboard) ||
                    (key === "move-left" && i === 0) ||
                    (key === "move-right" && i === project.slides.length - 1)
                  }
                  onSelect={() => op(key, slide.id)}
                >
                  <Icon />
                  {label}
                  {hint && <kbd>{hint}</kbd>}
                </ContextMenu.Item>
              ))}
              <ContextMenu.Separator className="menu-separator" />
              <ContextMenu.Item
                className="menu-item"
                disabled={!canUndo}
                onSelect={onUndo}
              >
                <Undo2 />
                Undo<kbd>⌘Z</kbd>
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      ))}
      {(project.slides.length === 0 || index === project.slides.length - 1) && (
        <Button
          className="filmstrip-add"
          data-id="add"
          onClick={() => op("add-after")}
        >
          <Plus />
          Add slide
        </Button>
      )}
    </div>
  );
}

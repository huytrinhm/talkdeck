import { useLayoutEffect, useRef } from "react";
import { Sparkles, Undo2, Plus } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/context-menu";
import { Button } from "./ui";
import { SlideView } from "./SlideView";
import type { Project } from "../domain/types";
/** Slide navigation and explicit structural Add. Content changes require speech or agent review. */
export function Filmstrip({
  project,
  selectedId,
  onSelect,
  onUndo,
  canUndo,
  onNavigate,
  onRefine,
  onAdd,
}: {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUndo: () => void;
  canUndo: boolean;
  onNavigate?: () => void;
  onRefine?: (slideId: string, invoker: HTMLElement) => void;
  onAdd: () => void;
}) {
  const ref = useRef<HTMLElement>(null),
    focusNext = useRef(false);
  useLayoutEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    const target =
      ref.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`) ??
      ref.current?.querySelector<HTMLElement>('[aria-label="Add slide"]');
    target?.focus();
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId, project.slides]);
  const undo = () => {
    focusNext.current = true;
    onUndo();
  };
  const choose = (id: string) => {
    onNavigate?.();
    focusNext.current = true;
    onSelect(id);
  };
  return (
    <nav
      className="filmstrip"
      aria-label="Slides"
      ref={ref}
      onKeyDown={(e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>(
          "[data-id]",
        );
        if (!target) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.stopPropagation();
          if (canUndo) undo();
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
          e.preventDefault();
          const box = target.getBoundingClientRect();
          target.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              clientX: box.left + 10,
              clientY: box.top + 10,
            }),
          );
          return;
        }
        const index = project.slides.findIndex(
            (s) => s.id === target.dataset.id,
          ),
          next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? project.slides.length - 1
                : e.key === "ArrowLeft"
                  ? Math.max(0, index - 1)
                  : e.key === "ArrowRight"
                    ? Math.min(project.slides.length - 1, index + 1)
                    : -1;
        if (next >= 0) {
          e.preventDefault();
          e.stopPropagation();
          choose(project.slides[next].id);
        }
      }}
    >
      {project.slides.map((slide, index) => (
        <ContextMenu key={slide.id}>
          <ContextMenuTrigger asChild>
            <button
              data-id={slide.id}
              className="filmstrip-thumbnail"
              aria-label={`Slide ${index + 1}: ${slide.title}`}
              aria-current={slide.id === selectedId}
              onClick={() => choose(slide.id)}
            >
              <SlideView slide={slide} />
              <span className="filmstrip-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuPortal>
            <ContextMenuContent
              className="menu"
              collisionPadding={8}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                ref.current
                  ?.querySelector<HTMLElement>(`[data-id="${slide.id}"]`)
                  ?.focus();
              }}
            >
              {onRefine && (
                <ContextMenuItem
                  className="menu-item"
                  onSelect={() => {
                    const invoker = ref.current?.querySelector<HTMLElement>(
                      `[data-id="${slide.id}"]`,
                    );
                    if (invoker) onRefine?.(slide.id, invoker);
                  }}
                >
                  <Sparkles />
                  Deep refine
                </ContextMenuItem>
              )}
              <ContextMenuItem
                className="menu-item"
                disabled={!canUndo}
                onSelect={undo}
              >
                <Undo2 />
                Undo
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenuPortal>
        </ContextMenu>
      ))}
      <Button
        className="add-slide"
        variant="ghost"
        onClick={() => {
          onNavigate?.();
          focusNext.current = true;
          onAdd();
        }}
        aria-label="Add slide"
        title="Add slide"
      >
        <Plus />
        <span>Add slide</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Undo"
        title="Undo"
        disabled={!canUndo}
        onClick={undo}
      >
        <Undo2 />
      </Button>
    </nav>
  );
}

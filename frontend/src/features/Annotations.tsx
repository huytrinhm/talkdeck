import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Eraser,
  GripVertical,
  Highlighter,
  PenLine,
  MousePointer2,
} from "lucide-react";
import { Button, Popover } from "../components/ui";
import "./annotations.css";
import { canvasCursor, type CanvasTool as Tool } from "./drawingCursor";
type Point = { x: number; y: number };
type Stroke = {
  points: Point[];
  tool: "pen" | "highlighter";
  color: string;
  width: number;
};
const memory = new Map<string, Stroke[]>();

const colors = [
  "#ef555e",
  "#f6c849",
  "#64bd9a",
  "#63a9ee",
  "#b798ef",
  "#ffffff",
];
const colorNames: Record<string, string> = {
  "#ef555e": "Red",
  "#f6c849": "Yellow",
  "#64bd9a": "Green",
  "#63a9ee": "Blue",
  "#b798ef": "Purple",
  "#ffffff": "White",
};
const guarded = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="menu"],[role="listbox"],[data-annotation-options]',
  );
function distance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function Annotations({
  slideId,
  stageRef,
  frameRef,
  disabled = false,
}: {
  slideId: string;
  stageRef: RefObject<HTMLDivElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
  disabled?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    active = useRef<Stroke | null>(null),
    toolRef = useRef<Tool>(null),
    held = useRef<string | null>(null),
    pointer = useRef<number | null>(null),
    owner = useRef(slideId);
  const [tool, setToolState] = useState<Tool>(null),
    [color, setColor] = useState("#ef555e"),
    [width, setWidth] = useState(2),
    [revision, redraw] = useState(0),
    [mounted, setMounted] = useState(false),
    [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const palette = useRef<HTMLDivElement>(null),
    positionRef = useRef(position);
  positionRef.current = position;
  const invalidate = () => redraw((n) => n + 1);
  const commit = () => {
    if (active.current?.points.length) {
      const list = memory.get(owner.current) ?? [];
      memory.set(owner.current, [...list, active.current].slice(-100));
    }
    active.current = null;
    pointer.current = null;
    invalidate();
  };
  const changeTool = (next: Tool) => {
    commit();
    toolRef.current = next;
    setToolState(next);
  };
  const clamp = (x: number, y: number) => {
    const stage = stageRef.current,
      box = palette.current;
    if (!stage) return { x, y };
    return {
      x: Math.max(
        8,
        Math.min(x, stage.clientWidth - (box?.offsetWidth ?? 52) - 8),
      ),
      y: Math.max(
        8,
        Math.min(y, stage.clientHeight - (box?.offsetHeight ?? 50) - 8),
      ),
    };
  };
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const previous = frame.style.cursor;
    frame.style.cursor = canvasCursor(tool);
    return () => {
      frame.style.cursor = previous;
    };
  }, [tool, frameRef, mounted]);
  useEffect(() => {
    active.current = null;
    pointer.current = null;
    held.current = null;
    owner.current = slideId;
    toolRef.current = null;
    setToolState(null);
    invalidate();
  }, [slideId]);
  useEffect(() => {
    if (disabled) {
      active.current = null;
      pointer.current = null;
      held.current = null;
      toolRef.current = null;
      setToolState(null);
      invalidate();
    }
  }, [disabled]);
  useEffect(() => {
    if (!mounted) return;
    const stage = stageRef.current;
    if (!stage) return;
    const resize = () => {
      setPosition((previous) =>
        clamp(
          previous?.x ?? 18,
          previous?.y ?? Math.max(8, (stage.clientHeight - 56) / 2),
        ),
      );
      invalidate();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    if (frameRef.current) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [mounted, stageRef, frameRef]);
  useEffect(() => {
    if (disabled) return;
    const release = () => {
      held.current = null;
      changeTool(null);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        if (held.current) release();
        return;
      }
      if (event.key === "Escape") {
        release();
        return;
      }
      if (
        guarded(event.target) ||
        document.querySelector(
          '[role="dialog"][data-state="open"],[role="menu"][data-state="open"]',
        ) ||
        document.fullscreenElement
      )
        return;
      const key = event.key.toLowerCase(),
        next =
          key === "d"
            ? "pen"
            : key === "h"
              ? "highlighter"
              : key === "e"
                ? "eraser"
                : null;
      if (next && !event.repeat) {
        event.preventDefault();
        held.current = key;
        changeTool(next);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === held.current) release();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", release);
      active.current = null;
      toolRef.current = null;
    };
  }, [disabled, slideId]);
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const rect = c.getBoundingClientRect(),
      dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.max(1, Math.round(rect.width * dpr));
    c.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of [
      ...(memory.get(slideId) ?? []),
      ...(active.current ? [active.current] : []),
    ]) {
      ctx.globalAlpha = stroke.tool === "highlighter" ? 0.28 : 1;
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width * (stroke.tool === "highlighter" ? 5 : 1);
      const pts = stroke.points.map((p) => ({
        x: p.x * rect.width,
        y: p.y * rect.height,
      }));
      if (!pts.length) continue;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const point of pts.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
    }
  }, [revision, slideId, mounted, disabled]);
  useEffect(() => {
    if (disabled) return;
    const point = (event: PointerEvent) => {
      const rect = canvas.current?.getBoundingClientRect();
      return rect
        ? {
            x: Math.max(
              0,
              Math.min(1, (event.clientX - rect.left) / rect.width),
            ),
            y: Math.max(
              0,
              Math.min(1, (event.clientY - rect.top) / rect.height),
            ),
          }
        : null;
    };
    const erase = (p: Point) => {
      const rect = canvas.current!.getBoundingClientRect(),
        pixel = { x: p.x * rect.width, y: p.y * rect.height };
      memory.set(
        slideId,
        (memory.get(slideId) ?? []).filter((stroke) => {
          const pts = stroke.points.map((q) => ({
            x: q.x * rect.width,
            y: q.y * rect.height,
          }));
          return !pts.some(
            (q, i) => distance(pixel, q, pts[Math.max(0, i - 1)]) <= 12,
          );
        }),
      );
      invalidate();
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !toolRef.current) return;
      event.preventDefault();
      const p = point(event);
      if (!p) return;
      pointer.current = event.pointerId;
      canvas.current?.setPointerCapture(event.pointerId);
      if (toolRef.current === "eraser") erase(p);
      else
        active.current = { points: [p], tool: toolRef.current, color, width };
      invalidate();
    };
    const move = (event: PointerEvent) => {
      if (pointer.current !== event.pointerId) return;
      event.preventDefault();
      const p = point(event);
      if (!p) return;
      if (toolRef.current === "eraser") {
        erase(p);
        return;
      }
      if (active.current) {
        active.current.points.push(p);
        if (active.current.points.length > 2048)
          active.current.points = active.current.points.filter(
            (_, i, points) => i % 2 === 0 || i === points.length - 1,
          );
        invalidate();
      }
    };
    const up = (event: PointerEvent) => {
      if (pointer.current === event.pointerId) commit();
    };
    const cancel = (event: PointerEvent) => {
      if (pointer.current !== event.pointerId) return;
      active.current = null;
      pointer.current = null;
      invalidate();
    };
    const c = canvas.current;
    c?.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    return () => {
      c?.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
    };
  }, [mounted, disabled, slideId, color, width]);
  const drag = (event: React.PointerEvent) => {
    event.preventDefault();
    const origin = positionRef.current ?? { x: 16, y: 16 },
      start = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget as HTMLButtonElement;
    const move = (e: PointerEvent) =>
      setPosition(
        clamp(origin.x + e.clientX - start.x, origin.y + e.clientY - start.y),
      );
    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };
  if (!mounted || disabled || !frameRef.current || !stageRef.current)
    return null;
  const choose = (next: Tool) => {
    held.current = null;
    changeTool(toolRef.current === next ? null : next);
  };
  const options = (kind: "pen" | "highlighter") => {
    const railBox = palette.current?.getBoundingClientRect();
    const toolBox = palette.current
      ?.querySelectorAll<HTMLElement>(".ink-tool")
      [kind === "pen" ? 0 : 1]?.getBoundingClientRect();
    const popupWidth = window.innerWidth <= 700 ? 242 : 382;
    const popupHeight = window.innerWidth <= 700 ? 115 : 66;
    let side: "right" | "left" | "top" | "bottom" = "right",
      sideOffset = 8;
    if (
      toolBox &&
      railBox &&
      window.innerWidth - toolBox.right - 12 < popupWidth
    ) {
      if (toolBox.left - 12 >= popupWidth) side = "left";
      else if (railBox.top - 8 >= popupHeight) {
        side = "top";
        sideOffset = toolBox.top - railBox.top + 8;
      } else {
        side = "bottom";
        sideOffset = railBox.bottom - toolBox.bottom + 8;
      }
    }
    return (
      <Popover
        side={side}
        sideOffset={sideOffset}
        align="center"
        anchor={<span className="ink-popover-anchor" aria-hidden="true" />}
        contentClassName="ink-options-popover"
        trigger={
          <Button
            variant="ghost"
            className="ink-corner"
            aria-label={`${kind} color and thickness`}
            onClick={() => {
              held.current = null;
              changeTool(kind);
            }}
          >
            <ChevronDown size={10} />
          </Button>
        }
      >
        <div data-annotation-options className="ink-options">
          <div className="ink-colors">
            {colors.map((c) => (
              <button
                key={c}
                aria-label={`${colorNames[c]} ink`}
                title={`${colorNames[c]} ink`}
                aria-pressed={color === c}
                style={{ background: c }}
                onClick={() => {
                  commit();
                  setColor(c);
                }}
              />
            ))}
          </div>
          <span className="ink-options-divider" aria-hidden="true" />
          <div className="ink-sizes" role="group" aria-label="Ink thickness">
            {[2, 5, 8].map((n) => (
              <button
                key={n}
                aria-label={`${n} px thickness`}
                title={`${n} px thickness`}
                aria-pressed={width === n}
                onClick={() => {
                  commit();
                  setWidth(n);
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ width: n + 3, height: n + 3 }}
                />
              </button>
            ))}
          </div>
        </div>
      </Popover>
    );
  };
  return (
    <>
      {createPortal(
        <canvas
          ref={canvas}
          className="ink-canvas"
          aria-label="Slide annotations"
          data-canvas-tool={tool ?? "pointer"}
          style={{
            pointerEvents: tool ? "auto" : "none",
            cursor: canvasCursor(tool),
          }}
        />,
        frameRef.current,
      )}
      {createPortal(
        <div
          ref={palette}
          className="ink-palette expanded"
          role="toolbar"
          aria-label="Drawing tools"
          style={{ left: position?.x ?? 18, top: position?.y ?? 16 }}
        >
          {
            <button
              className="ink-grip"
              aria-label="Move drawing tools"
              title="Drag to move drawing tools"
              onPointerDown={drag}
              onKeyDown={(event) => {
                const offsets: Record<string, [number, number]> = {
                  ArrowLeft: [-10, 0],
                  ArrowRight: [10, 0],
                  ArrowUp: [0, -10],
                  ArrowDown: [0, 10],
                };
                const offset = offsets[event.key];
                if (offset) {
                  event.preventDefault();
                  event.stopPropagation();
                  const current = positionRef.current ?? { x: 18, y: 16 };
                  setPosition(
                    clamp(current.x + offset[0], current.y + offset[1]),
                  );
                }
              }}
            >
              <GripVertical size={13} />
            </button>
          }
          {
            <>
              <div className="ink-tool">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Pen (hold D)"
                  aria-pressed={tool === "pen"}
                  onClick={() => choose("pen")}
                >
                  <PenLine size={18} />
                </Button>
                {options("pen")}
              </div>
              <div className="ink-tool">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Highlighter (hold H)"
                  aria-pressed={tool === "highlighter"}
                  onClick={() => choose("highlighter")}
                >
                  <Highlighter size={18} />
                </Button>
                {options("highlighter")}
              </div>
              <div className="ink-tool">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Erase whole stroke (hold E)"
                  aria-pressed={tool === "eraser"}
                  onClick={() => choose("eraser")}
                >
                  <Eraser size={18} />
                </Button>
              </div>
              <span className="ink-count" aria-live="polite">
                {(memory.get(slideId) ?? []).length}{" "}
                {(memory.get(slideId) ?? []).length === 1 ? "mark" : "marks"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Pointer (Esc)"
                title="Pointer (Esc)"
                aria-pressed={tool === null}
                onClick={() => changeTool(null)}
              >
                <MousePointer2 size={16} />
              </Button>
            </>
          }
        </div>,
        stageRef.current,
      )}
    </>
  );
}

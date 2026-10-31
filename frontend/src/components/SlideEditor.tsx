import { useEffect, useState } from "react";
import { Button, Input, Textarea, Modal } from "./ui";
import type { Layout, Slide } from "../domain/types";
import { editSlide, editorContent } from "../domain/editor";
export function SlideEditor({
  slide,
  onClose,
  onSave,
  onRemove,
}: {
  slide: Slide | null;
  onClose: () => void;
  onSave: (slide: Slide) => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [layout, setLayout] = useState<Layout>("title"),
    [error, setError] = useState("");
  useEffect(() => {
    if (slide) {
      setTitle(slide.title);
      setContent(editorContent(slide));
      setLayout(slide.layout);
      setError("");
    }
  }, [slide]);
  return (
    <Modal
      open={Boolean(slide)}
      onOpenChange={(open) => !open && onClose()}
      title="Edit slide"
      className="edit-slide-content"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!slide) return;
          try {
            onSave(editSlide(slide, title, content, layout));
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <label className="field">
          Title
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          Content
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
          />
          {layout === "table" && (
            <span className="muted">
              One row per line. Separate cells with |; the first row contains
              column headers.
            </span>
          )}
        </label>
        <span className="field">Layout</span>
        <div className="layout-options">
          {(
            [
              "title",
              "bullets",
              "process",
              "comparison",
              "quote",
              "table",
              "code",
            ] as Layout[]
          ).map((value) => (
            <Button
              type="button"
              key={value}
              aria-pressed={layout === value}
              onClick={() => setLayout(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            Remove slide
          </Button>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

import type { CSSProperties, ReactNode } from "react";
import type { Slide } from "../domain/types";
import "../styles/slides.css";
export function SlideView({
  slide,
  compare,
  diff,
}: {
  slide: Slide;
  compare?: Slide;
  diff?: "removed" | "added";
}) {
  const marked = (text: string, other?: string): ReactNode => {
    if (!diff || other === text) return text;
    const a = text.split(/(\s+)/),
      b = new Set((other ?? "").split(/\s+/));
    return a.map((word, i) =>
      b.has(word) || !word.trim() ? (
        word
      ) : (
        <mark className={`diff-${diff}`} key={i}>
          {word}
        </mark>
      ),
    );
  };
  const body = (line: string, i: number) => marked(line, compare?.body[i]);
  const split = (line: string) => {
    const i = line.indexOf(":");
    return i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + 1)];
  };
  return (
    <article
      className={`slide-page slide-theme-${slide.theme} slide-layout-${slide.layout} ${slide.body.length > 4 ? "slide-dense" : ""} ${slide.body.length > 7 ? "slide-very-dense" : ""} ${slide.tableData ? "slide-imported-table slide-table-compact" : ""}`}
      style={
        { "--slide-count": Math.max(1, slide.body.length) } as CSSProperties
      }
      aria-label={slide.title}
    >
      {slide.layout === "quote" && (
        <div className="slide-quote-mark" aria-hidden>
          “
        </div>
      )}
      <h2 className="slide-heading">{marked(slide.title, compare?.title)}</h2>
      {slide.layout === "title" && (
        <>
          <p className="slide-lead">{body(slide.body[0] ?? "", 0)}</p>
          {slide.body.length > 1 && (
            <ul className="slide-title-details">
              {slide.body.slice(1).map((s, i) => (
                <li key={i}>{body(s, i + 1)}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {slide.layout === "bullets" && (
        <ul className="slide-list">
          {slide.body.map((s, i) => (
            <li key={i}>{body(s, i)}</li>
          ))}
        </ul>
      )}
      {slide.layout === "process" && (
        <ol className="slide-process">
          {slide.body.map((s, i) => {
            const [a, b] = split(s);
            return (
              <li key={i}>
                <span className="slide-step">{i + 1}</span>
                <h3>
                  {marked(a, compare?.body[i] && split(compare.body[i])[0])}
                </h3>
                {b && (
                  <p>
                    {marked(b, compare?.body[i] && split(compare.body[i])[1])}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {slide.layout === "comparison" && (
        <div className="slide-comparison">
          {slide.body.map((s, i) => {
            const [a, b] = split(s);
            return (
              <article key={i}>
                <h3>
                  {marked(a, compare?.body[i] && split(compare.body[i])[0])}
                </h3>
                <p>
                  {marked(b, compare?.body[i] && split(compare.body[i])[1])}
                </p>
              </article>
            );
          })}
        </div>
      )}
      {slide.layout === "quote" && (
        <p className="slide-attribution">{slide.body.map(body)}</p>
      )}
      {slide.layout === "code" && (
        <>
          <pre className="slide-code">
            <code>{body(slide.body[0] ?? "", 0)}</code>
          </pre>
          <div className="slide-code-results">
            {slide.body.slice(1).map((s, i) => (
              <p key={i}>{body(s, i + 1)}</p>
            ))}
          </div>
        </>
      )}
      {slide.layout === "table" &&
        (slide.tableData ? (
          <>
            <table className="slide-table">
              <thead>
                <tr>
                  {slide.tableData.columns.map((s, i) => (
                    <th key={i}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slide.tableData.rows
                  .slice(
                    (slide.materialRef?.page ?? 0) * 8,
                    (slide.materialRef?.page ?? 0) * 8 + 8,
                  )
                  .map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{String(cell ?? "")}</td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="slide-table-source">
              {slide.tableData.name}
              {slide.tableData.rows.length > 8
                ? ` · Page ${(slide.materialRef?.page ?? 0) + 1} of ${Math.ceil(slide.tableData.rows.length / 8)}`
                : ""}
            </p>
          </>
        ) : (
          <div className="slide-body">
            {slide.body.map((s, i) => (
              <p key={i}>{body(s, i)}</p>
            ))}
          </div>
        ))}
      <footer className="slide-signature">
        <span>Made with Talkdeck</span>
      </footer>
    </article>
  );
}

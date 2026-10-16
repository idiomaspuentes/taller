import { useEffect, useState } from "react";

export type LoadingShape = "tool" | "list" | "text";

/**
 * What is coming, drawn while it comes: the shape of a tool's card, of a list's cards, or of lines of text, with a
 * soft sheen. «Cargando…» alone, a grey line at the top of an empty screen, read as nothing happening (16 October).
 * The words are said at once to a screen reader, and shown under the shapes when it takes longer than a few seconds,
 * so that a slow connection does not look like a screen that hung.
 */
export function LoadingState({ shape = "text", label, lines = 4 }: { shape?: LoadingShape; label: string; lines?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 5000);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="ld" data-shape={shape} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden>
        {shape === "tool" ? (
          <div className="ld-card">
            <i className="ld-line" style={{ width: "22%" }} />
            <i className="ld-line ld-line--title" style={{ width: "48%" }} />
            <div className="ld-block">
              <i className="ld-line" style={{ width: "92%" }} />
              <i className="ld-line" style={{ width: "86%" }} />
              <i className="ld-line" style={{ width: "64%" }} />
            </div>
            <i className="ld-line ld-line--title" style={{ width: "70%" }} />
            <div className="ld-row">
              <i className="ld-pill ld-pill--fill" />
              <i className="ld-pill" />
            </div>
          </div>
        ) : shape === "list" ? (
          <div className="ld-list">
            {[0, 1, 2].map((n) => (
              <div key={n} className="ld-card">
                <i className="ld-line ld-line--title" style={{ width: `${62 - n * 8}%` }} />
                <i className="ld-line" style={{ width: "100%", height: "0.375rem" }} />
                <i className="ld-pill ld-pill--fill" />
              </div>
            ))}
          </div>
        ) : (
          <div className="ld-text">
            {Array.from({ length: lines }, (_, n) => (
              <i key={n} className="ld-line" style={{ width: n === lines - 1 ? "58%" : `${96 - (n % 3) * 6}%` }} />
            ))}
          </div>
        )}
      </div>
      {slow ? (
        <p className="ld-slow" aria-hidden>
          {label}
        </p>
      ) : null}
    </div>
  );
}

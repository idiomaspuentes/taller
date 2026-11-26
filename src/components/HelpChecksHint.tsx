import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { HelpsAddress } from "../domain/formalAddress";
import { applyFixes, caretAfterFixes, checksOf, type HelpCheck, type HelpKind } from "../domain/helpChecks";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

/** At most this many in sight; the rest behind «Ver N más». */
const SHOWN = 3;

/**
 * Under a proposed note or Words article, or a verse being corrected: what Taller found by itself. One line says how
 * many; touched, it opens the
 * list, three at a time. Mechanical slips are fixed together with one «Arreglar»; the team's rules say why on request
 * and are never fixed for the person. Nothing shows when nothing was found, and nothing here stops anyone proposing
 * or agreeing.
 *
 * In an editor, where the text is being written, it takes more:
 * - `address` adds the words that speak to the translator as «tú» among what is found, fixable like the rest;
 * - `past` is what the help has before this piece (for the rules that end at a heading), `doubleSpace` asks for the
 *   doubled space of a verse;
 * - `settle` waits that many milliseconds without typing before the line is worked out again, so it does not change
 *   under the finger. «Arreglar» never waits: it works on the text as it is now;
 * - `quiet` is the discreet form, and adds «Deshacer» right after a fix, until the text changes by other means.
 * Without any of these it looks and behaves as it always did.
 */
export function HelpChecksHint({
  text,
  kind,
  before,
  past,
  address,
  doubleSpace,
  quiet,
  settle,
  onFix,
}: {
  text: string;
  kind: HelpKind | "verse";
  before?: string;
  past?: string;
  address?: HelpsAddress;
  doubleSpace?: boolean;
  quiet?: boolean;
  settle?: number;
  onFix?: (next: string) => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  // The text the line is worked out on: the current one, or the one of the last pause when `settle` is given.
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    if (!settle) return;
    const timer = setTimeout(() => setSettled(text), settle);
    return () => clearTimeout(timer);
  }, [text, settle]);
  const shownText = settle ? settled : text;
  // «Deshacer»: the text before a fix, and the first text received after it (a note comes back by another path).
  const [undo, setUndo] = useState<{ before: string; after: string | null } | null>(null);
  useEffect(() => {
    if (!undo) return;
    if (undo.after === null) {
      if (text !== undo.before) setUndo({ ...undo, after: text });
    } else if (text !== undo.after) setUndo(null);
  }, [text, undo]);
  const undoable = Boolean(quiet && undo && (undo.after === null || text === undo.after));
  const options = { before, past, address, doubleSpace, language };
  const checks = useMemo(
    () => checksOf(shownText, kind, { before, past, address, doubleSpace, language }),
    [shownText, kind, before, past, address, doubleSpace, language],
  );
  if (!checks.length && !undoable) return null;
  const fixable = checks.some((check) => check.fix === "auto");
  const shown = all ? checks : checks.slice(0, SHOWN);
  const messageOf = (check: HelpCheck) =>
    "text" in check.message ? check.message.text : Object.entries(check.message.params ?? {}).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), t(check.message.key));
  const keyOf = (check: HelpCheck) => `${check.id}-${check.start}`;

  const fix = () => {
    if (!onFix) return;
    // On the text as it is now, never on the list of the last pause: that one may point to places that moved.
    const now = checksOf(text, kind, options);
    const next = applyFixes(text, now);
    const field = document.activeElement;
    // Only in an editor (`quiet`): Afinación and the sheets keep fixing as they always did.
    const caretAt =
      quiet && (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) && field.value === text ? caretAfterFixes(field.selectionStart ?? text.length, now) : null;
    if (quiet && next !== text) setUndo({ before: text, after: null });
    onFix(next);
    setSettled(next);
    if (caretAt !== null) {
      requestAnimationFrame(() => {
        if (document.activeElement === field) (field as HTMLTextAreaElement | HTMLInputElement).setSelectionRange(caretAt, caretAt);
      });
    }
  };
  const undoFix = () => {
    if (!undo || !onFix) return;
    onFix(undo.before);
    setSettled(undo.before);
    setUndo(null);
  };

  // The number gets its own color in the discreet form; the phrase is split around it so any language reads right.
  let label: ReactNode;
  if (!checks.length) label = t("hc.fixed");
  else if (checks.length === 1) label = quiet ? <span className="hc-hint__n">{t("hc.foundOne")}</span> : t("hc.foundOne");
  else if (quiet) {
    const [lead, tail] = t("hc.found").split("{n}");
    // One span around it all: the toggle lays its children out as flex items, which would drop the spaces.
    label = (
      <span>
        {lead}
        <span className="hc-hint__n">{checks.length}</span>
        {tail}
      </span>
    );
  } else label = t("hc.found").replace("{n}", String(checks.length));

  return (
    <div className={quiet ? "hc-hint hc-hint--quiet" : "hc-hint"} role="status">
      <div className="hc-hint__head">
        {checks.length ? (
          <button type="button" className="hc-hint__toggle" aria-expanded={open} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(!open)}>
            {label}
          </button>
        ) : (
          <span className="hc-hint__toggle">{label}</span>
        )}
        {/* The press must not take the cursor out of the text: on a phone the keyboard would go down and come up again. */}
        {undoable && onFix ? (
          <button type="button" className="hc-hint__fix" onMouseDown={(event) => event.preventDefault()} onClick={undoFix}>
            {t("hc.undo")}
          </button>
        ) : fixable && onFix ? (
          <button type="button" className="hc-hint__fix" onMouseDown={(event) => event.preventDefault()} onClick={fix}>
            {t("hc.fix")}
          </button>
        ) : null}
      </div>
      {open && checks.length ? (
        <ul className="hc-hint__list">
          {shown.map((check) => (
            <li key={keyOf(check)} className="hc-hint__item">
              <span className="hc-hint__excerpt">{check.excerpt}</span>
              <span className="hc-hint__msg">{messageOf(check)}</span>
              {check.why ? (
                why === keyOf(check) ? (
                  <span className="hc-hint__why">{check.why}</span>
                ) : (
                  <button type="button" className="af-link hc-hint__whyBtn" onMouseDown={(event) => event.preventDefault()} onClick={() => setWhy(keyOf(check))}>
                    {t("hc.why")}
                  </button>
                )
              ) : null}
            </li>
          ))}
          {!all && checks.length > SHOWN ? (
            <li>
              <button type="button" className="af-link hc-hint__more" onMouseDown={(event) => event.preventDefault()} onClick={() => setAll(true)}>
                {t("hc.more").replace("{n}", String(checks.length - SHOWN))}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** The kind of help a resource's proposals are checked as: only notes and Words articles are. */
export function helpKindOf(resource: string | undefined): HelpKind | null {
  return resource === "notas" || resource === "palabras" ? resource : null;
}

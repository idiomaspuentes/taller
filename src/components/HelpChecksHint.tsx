import { useMemo, useState } from "react";
import { applyFixes, mechanicalChecks, ruleChecks, type HelpCheck, type HelpKind } from "../domain/helpChecks";
import { writingChecks } from "../domain/processes";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

/** At most this many in sight; the rest behind «Ver N más». */
const SHOWN = 3;

/**
 * Under a proposed note or Words article: what Taller found by itself. One line says how many; touched, it opens the
 * list, three at a time. Mechanical slips are fixed together with one «Arreglar»; the team's rules say why on request
 * and are never fixed for the person. Nothing shows when nothing was found, and nothing here stops anyone proposing
 * or agreeing.
 */
export function HelpChecksHint({ text, kind, before, onFix }: { text: string; kind: HelpKind; before?: string; onFix?: (next: string) => void }) {
  const t = useT();
  const language = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const checks = useMemo(
    () => [...mechanicalChecks(text, { kind, before }), ...ruleChecks(text, kind, writingChecks(), language)].sort((a, b) => a.start - b.start),
    [text, kind, before, language],
  );
  if (!checks.length) return null;
  const fixable = checks.some((check) => check.fix === "auto");
  const shown = all ? checks : checks.slice(0, SHOWN);
  const messageOf = (check: HelpCheck) =>
    "text" in check.message ? check.message.text : Object.entries(check.message.params ?? {}).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), t(check.message.key));
  const keyOf = (check: HelpCheck) => `${check.id}-${check.start}`;
  return (
    <div className="hc-hint" role="status">
      <div className="hc-hint__head">
        <button type="button" className="hc-hint__toggle" aria-expanded={open} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(!open)}>
          {checks.length === 1 ? t("hc.foundOne") : t("hc.found").replace("{n}", String(checks.length))}
        </button>
        {/* The press must not take the cursor out of the text: on a phone the keyboard would go down and come up again. */}
        {fixable && onFix ? (
          <button type="button" className="hc-hint__fix" onMouseDown={(event) => event.preventDefault()} onClick={() => onFix(applyFixes(text, checks))}>
            {t("hc.fix")}
          </button>
        ) : null}
      </div>
      {open ? (
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

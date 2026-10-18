import { useMemo } from "react";
import { informalGroups, informalWords, toFormal, type HelpsAddress } from "../domain/formalAddress";
import { useT } from "../i18n/messages";

/**
 * Under a help being written: the words that speak to the translator as «tú», where the team says «usted», how each
 * would read, and one touch that changes them all. Nothing shows while the help says nothing like that, or where
 * the team has no rule (see `Workspace.helpsAddress`).
 */
export function FormalAddressHint({ text, address, onFix }: { text: string; address: HelpsAddress | undefined; onFix: (next: string) => void }) {
  const t = useT();
  const found = useMemo(() => informalWords(text, address), [text, address]);
  if (!found.length) return null;
  const groups = informalGroups(found);
  return (
    <div className="addr-hint" role="status">
      <p className="addr-hint__text">
        {t("addr.informal")}{" "}
        {groups.map((group, at) => (
          <span key={`${group.word}-${group.formal}`} className="addr-hint__pair">
            {at ? " · " : ""}«{group.word}» → «{group.formal}»{group.count > 1 ? ` (${group.count})` : ""}
          </span>
        ))}
      </p>
      {/* The press must not take the cursor out of the text: on a phone the keyboard would go down and come up again. */}
      <button type="button" className="addr-hint__fix" onMouseDown={(event) => event.preventDefault()} onClick={() => onFix(toFormal(text, found))}>
        {t("addr.fix")}
      </button>
    </div>
  );
}

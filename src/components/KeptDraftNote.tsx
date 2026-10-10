import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";

export type KeptDraftView = {
  /** The name it is kept under: what it is discarded by. */
  key: string;
  /** What it is of, when it says so («Jonás 1:4–8»). */
  name: string;
  savedAt: number;
  rows: { label: string; text: string }[];
};

/**
 * A draft that is on this device and was not put in the editor, because nothing proves it is of this passage (see
 * `DraftLookup.aside`). It is said where the person writes and shown for them to take what is theirs: put in the
 * editor, the text of another passage would be saved over this one; dropped by the app, what somebody wrote and
 * had not saved would be gone without a word.
 */
export function KeptDraftNote({
  drafts,
  onDiscard,
  announce,
}: {
  drafts: KeptDraftView[];
  onDiscard: (key: string) => void;
  announce: (msg: string) => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const [open, setOpen] = useState(false);
  /** Asked apart from the list: what is discarded is nowhere else. */
  const [discarding, setDiscarding] = useState<string | null>(null);
  if (!drafts.length) return null;
  const when = (savedAt: number) => (savedAt ? t("kd.keptOn").replace("{date}", new Date(savedAt).toLocaleDateString(language, { day: "numeric", month: "long" })) : "");
  const copy = (text: string) => {
    // A browser may refuse (no permission, a page not in front): the text can still be selected by hand.
    void navigator.clipboard?.writeText(text).then(
      () => announce(t("kd.copied")),
      () => announce(t("kd.copyFailed")),
    );
  };
  return (
    <>
      <button type="button" className="se-review-note kd-note" onClick={() => setOpen(true)}>
        {t("kd.note")}
      </button>
      <Dialog open={open && !discarding} onOpenChange={setOpen}>
        <DialogContent className="kd-dialog">
          <DialogHeader>
            <DialogTitle>{t("kd.title")}</DialogTitle>
            <DialogDescription>{t("kd.why")}</DialogDescription>
          </DialogHeader>
          <div className="kd-drafts">
            {drafts.map((draft) => (
              <section key={draft.key} className="kd-draft">
                <h3 className="kd-draft__name">{[draft.name, when(draft.savedAt)].filter(Boolean).join(" · ")}</h3>
                <ul className="kd-rows">
                  {draft.rows.map((row, index) => (
                    <li key={index} className="kd-row">
                      <span className="kd-row__label">{row.label}</span>
                      <p className="kd-row__text">{row.text}</p>
                      {typeof navigator !== "undefined" && navigator.clipboard ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => copy(row.text)}>
                          {t("kd.copy")}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <Button type="button" size="sm" variant="ghost" className="kd-draft__discard" onClick={() => setDiscarding(draft.key)}>
                  {t("kd.discard")}
                </Button>
              </section>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)}>
              {t("se.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(discarding)}
        title={t("kd.discardTitle")}
        text={t("kd.discardText")}
        yes={t("kd.discardYes")}
        safe
        // Either way back to the list (closing it to ask left it closed): what is left of it, when something is.
        onYes={() => {
          if (discarding) onDiscard(discarding);
          setDiscarding(null);
          setOpen(true);
        }}
        onNo={() => {
          setDiscarding(null);
          setOpen(true);
        }}
      />
    </>
  );
}

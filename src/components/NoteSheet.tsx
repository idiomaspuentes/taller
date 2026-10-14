import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { loadArticleBody, loadArticleInfo } from "../dcs/afinacionLoad";
import type { BookNote } from "../dcs/proposalList";
import { articlePathOf } from "../domain/afinacionNotes";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import type { SourcePackage } from "../domain/sourcePackage";
import { useT } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";

/**
 * A note named in a reason, opened over the proposal: where it is, the words of the original it is about, what it
 * says, and the article it points to, to read there too. The team's own wording when it has one.
 */
export function NoteSheet({ note, session, ctx, pkg, onClose }: { note: BookNote | null; session: GtSession; ctx: SolverLaunchContext; pkg: SourcePackage; onClose: () => void }) {
  const t = useT();
  const path = note ? articlePathOf(note.supportRef) : "";
  const [title, setTitle] = useState("");
  const [article, setArticle] = useState<string | null | undefined>(undefined);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    setTitle("");
    setArticle(undefined);
    setReading(false);
    if (!path) return;
    let alive = true;
    void loadArticleInfo(session, ctx, pkg, [path])
      .then((found) => alive && setTitle(found[path]?.title ?? ""))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, note?.id]);

  async function read() {
    setReading(true);
    setArticle(await loadArticleBody(session, ctx, pkg, path).catch(() => null));
  }

  return (
    <Dialog open={Boolean(note)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="word-sheet note-sheet" aria-label={t("ns.aria")}>
        {note ? (
          <>
            <DialogTitle className="ns-title">{t("ns.title").replace("{id}", note.id).replace("{ref}", note.ref)}</DialogTitle>
            {note.quote ? (
              <p className="ns-quote" lang="hbo" dir="rtl">
                {note.quote}
              </p>
            ) : null}
            <div className="ns-body">
              <HelpMarkdownView content={note.note.replace(/\n/g, "\n\n")} />
            </div>
            {path ? (
              <section className="ns-article">
                {article === undefined ? (
                  <Button type="button" variant="outline" disabled={reading} onClick={() => void read()}>
                    {reading ? t("ns.loading") : t("ns.readArticle").replace("{title}", title || path)}
                  </Button>
                ) : article ? (
                  <>
                    <h3 className="ns-article__title">{title || path}</h3>
                    <HelpMarkdownView content={article} />
                  </>
                ) : (
                  <p className="af-hint">{t("ns.noArticle")}</p>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

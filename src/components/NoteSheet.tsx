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
export function NoteSheet({
  note,
  articlePath,
  phrase,
  textName,
  session,
  ctx,
  pkg,
  onClose,
}: {
  note: BookNote | null;
  /** An Academy article opened on its own, from a reason that cites it («translate/figs-metaphor»). */
  articlePath?: string | null;
  /** The quote in the team's text, as notes are called by elsewhere; `"loading"` while it is looked for. */
  phrase?: string | null | "loading";
  textName: string;
  session: GtSession;
  ctx: SolverLaunchContext;
  pkg: SourcePackage;
  onClose: () => void;
}) {
  const t = useT();
  const path = note ? articlePathOf(note.supportRef) : (articlePath ?? "");
  const alone = !note && Boolean(articlePath);
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
    // Opened for the article alone: it is what there is to read.
    if (alone) void loadArticleBody(session, ctx, pkg, path).then((body) => alive && setArticle(body), () => alive && setArticle(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, note?.id, alone]);

  async function read() {
    setReading(true);
    setArticle(await loadArticleBody(session, ctx, pkg, path).catch(() => null));
  }

  return (
    <Dialog open={Boolean(note) || alone} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="word-sheet note-sheet" aria-label={t(alone ? "ns.articleAria" : "ns.aria")}>
        {alone ? (
          <>
            <DialogTitle className="ns-title">{title || path}</DialogTitle>
            <section className="ns-article ns-article--alone">{article === undefined ? <p className="af-hint">{t("ns.loading")}</p> : article ? <HelpMarkdownView content={article} /> : <p className="af-hint">{t("ns.noArticle")}</p>}</section>
          </>
        ) : null}
        {note ? (
          <>
            <DialogTitle className="ns-title">{t("ns.title").replace("{id}", note.id).replace("{ref}", note.ref)}</DialogTitle>
            {note.quote ? (
              <div className="ns-quote-box">
                {phrase && phrase !== "loading" ? (
                  <p className="ns-phrase">
                    <span className="ns-phrase__text">{phrase}</span>
                    <span className="pl-tag">{textName}</span>
                  </p>
                ) : phrase === "loading" ? (
                  <p className="ns-phrase ns-phrase--wait" aria-busy="true">
                    {" "}
                  </p>
                ) : null}
                <p className="ns-quote" lang="hbo" dir="rtl">
                  {note.quote}
                </p>
              </div>
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

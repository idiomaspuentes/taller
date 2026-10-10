import { useEffect, useState } from "react";
import { getDefaultBranch } from "../dcs/pulls";
import { draftTaskId, groupDraftBranches } from "../dcs/afinacionLoad";
import type { GtSession } from "../dcs/auth";
import { tryReadExistingBookUsfm } from "../dcs/bookBootstrap";
import { dcsConfig } from "../dcs/config";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import type { AssignmentsDoc } from "../domain/types";
import { parseRefRange } from "../domain/usfmEdit";
import { useT } from "../i18n/messages";
import { ChapterReader } from "./ChapterReader";

/** Whether a conversation is about a passage of a text that can be shown: the literal or the simple translation. */
export function hasPassage(ctx: Pick<SolverLaunchContext, "resource" | "chapter" | "book"> | null | undefined): boolean {
  return Boolean(ctx?.book && ctx.chapter > 0 && /^(tpl|tps)$/.test((ctx.resource || "").toLowerCase()));
}

/**
 * The passage a conversation is about, to be read where it is talked about: the group's draft as it is now, with
 * the original and the texts it is translated from a touch away. Whoever is called to a conversation by a notice
 * was not in the task, and had only the words of the others to go by. It is read, never changed, and is the same
 * for whoever has the task and whoever does not.
 */
export function PassageContext({ session, ctx, board }: { session: GtSession; ctx: SolverLaunchContext; board: AssignmentsDoc }) {
  const t = useT();
  const [draft, setDraft] = useState<{ owner: string; repo: string; branch: string; filepath: string } | null | undefined>(undefined);
  const resource = (ctx.resource || "").toLowerCase() === "tps" ? "tps" : "tpl";

  useEffect(() => {
    let alive = true;
    setDraft(undefined);
    void (async () => {
      const target = resolveScriptureTarget(ctx);
      if ("error" in target) return alive && setDraft(null);
      try {
        // The group's draft when the book has one; what is published when it has not.
        const found = await tryReadExistingBookUsfm({ session, owner: target.owner, repo: target.repo, filepath: target.filepath, branches: [...groupDraftBranches(target.book, draftTaskId(board.teams, resource) ?? ""), undefined] });
        const branch = found?.branch || (await getDefaultBranch(dcsConfig(session.host), target.owner, target.repo, session.token));
        if (alive) setDraft(found && branch ? { owner: target.owner, repo: target.repo, branch, filepath: target.filepath } : null);
      } catch {
        if (alive) setDraft(null);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, ctx.book, ctx.resource, ctx.contentOrg, ctx.lang]);

  if (draft === undefined) return <p className="af-hint">{t("cv.passageLoading")}</p>;
  if (!draft) return <p className="af-hint">{t("cv.passageNone")}</p>;
  const range = parseRefRange(ctx.ref || "");
  return (
    <ChapterReader
      session={session}
      book={ctx.book}
      pkg={resolveSourcePackage(board.settings)}
      draft={draft}
      draftLabel={t("af.draftLabel").replace("{res}", resource === "tps" ? "TPS" : "TPL")}
      chapter={ctx.chapter}
      from={range?.chapter === ctx.chapter ? range.from : 1}
      to={range?.chapter === ctx.chapter ? range.to : undefined}
    />
  );
}

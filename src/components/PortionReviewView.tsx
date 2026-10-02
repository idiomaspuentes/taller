import { useCallback, useEffect, useState } from "react";
import { loadSession, type GtSession } from "../dcs/auth";
import {
  commentOnPortionPr,
  ensurePortionPr,
  getPmIssue,
  loadLinkedPull,
  loadLinkedPullFiles,
} from "../dcs/portionPr";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { getPullDiff, type DcsPull, type DcsPullFile } from "../dcs/pulls";
import { dcsConfig } from "../dcs/config";
import {
  decodeSolverLaunchContext,
  type SolverLaunchContext,
} from "../domain/solverLaunch";
import { parsePortionPrMarker, translatorLoginFromHead, type PortionPrMarker } from "../domain/portionPr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tNow, useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";
import { localizeName } from "../domain/templateNames";
import { explainError } from "../dcs/userError";

type Props = {
  ctxEncoded: string;
  mode: "pair" | "group";
  onClose: () => void;
  announce: (msg: string) => void;
};

export function PortionReviewView({ ctxEncoded, mode, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session, setSession] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [marker, setMarker] = useState<PortionPrMarker | null>(null);
  const [pull, setPull] = useState<DcsPull | null>(null);
  const [files, setFiles] = useState<DcsPullFile[]>([]);
  const [diff, setDiff] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError(tNow("se.badContext"));
      return;
    }
    setCtx(decoded);
    const sess = loadSession();
    setSession(sess);
    if (!sess?.token) {
      setError(tNow("pr.needSession"));
      return;
    }
    if (!decoded.issueNumber) {
      setError(tNow("pr.noIssue"));
      return;
    }

    setBusy(true);
    setError("");
    try {
      const issue = await getPmIssue(sess, decoded.pmOrg, decoded.issueNumber);
      let linked = parsePortionPrMarker(issue.body);
      if (!linked) {
        setMarker(null);
        setPull(null);
        setFiles([]);
        setDiff("");
        return;
      }
      setMarker(linked);
      const [nextPull, nextFiles, nextDiff] = await Promise.all([
        loadLinkedPull(sess, linked),
        loadLinkedPullFiles(sess, linked),
        getPullDiff(
          dcsConfig(sess.host),
          linked.owner,
          linked.repo,
          linked.number,
          sess.token,
        ).catch(() => ""),
      ]);
      setPull(nextPull);
      setFiles(nextFiles);
      setDiff(nextDiff);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openPr() {
    if (!session || !ctx) return;
    setActing(true);
    setError("");
    try {
      const issue = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
      const board = await loadAssignmentsFromDcs(
        session,
        ctx.pmOrg,
        ctx.lang,
        ctx.projectId,
        ctx.contentOrg,
      );
      if (!board) throw new Error(tNow("pr.noPlan"));
      const result = await ensurePortionPr({
        session,
        pmOrg: ctx.pmOrg,
        lang: ctx.lang,
        contentOrg: ctx.contentOrg,
        board,
        issue,
      });
      setMarker(result.marker);
      announce(
        result.created ? tNow("pr.opened") : tNow("pr.wasOpen"),
      );
      await load();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setActing(false);
    }
  }

  async function sendComment() {
    if (!session || !marker) return;
    const body = comment.trim();
    if (!body) return;
    setActing(true);
    setError("");
    try {
      await commentOnPortionPr(session, marker, body);
      setComment("");
      announce(tNow("pr.commentSent"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setActing(false);
    }
  }

  const modeLabel = mode === "group" ? t("pr.group") : t("pr.pairs");
  const draftOwner = marker ? translatorLoginFromHead(marker.head, [session?.username]) : "";
  const draftLabel =
    !draftOwner || draftOwner.toLowerCase() === session?.username.toLowerCase()
      ? t("pr.yourDraft")
      : t("pr.draftOf").replace("{who}", draftOwner);

  return (
    <div className="scripture-editor">
      <header className="scripture-editor__head">
        <div className="min-w-0">
          <p className="scripture-editor__kicker">{t("pr.online").replace("{mode}", modeLabel)}</p>
          <h1 className="scripture-editor__title">
            {ctx ? `${ctx.book} ${ctx.ref}` : modeLabel}
          </h1>
          <p className="scripture-editor__meta">
            {ctx?.taskName ? `${localizeName(ctx.taskName, language)} · ` : ""}
            {marker ? t("pr.reviewOf").replace("{draft}", draftLabel) : t("pr.noReviewYet")}
            {pull?.merged ? t("pr.merged") : ""}
            {ctx?.issueNumber ? t("pr.subtask").replace("{n}", String(ctx.issueNumber)) : ""}
          </p>
        </div>
        <div className="scripture-editor__actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("se.close")}
          </Button>
          {marker?.htmlUrl ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.open(marker.htmlUrl, "_blank", "noopener,noreferrer")}
            >
              {t("se.openDoor43")}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={acting || !session}
              onClick={() => void openPr()}
            >
              {acting ? t("se.opening") : t("pr.openThis")}
            </Button>
          )}
        </div>
      </header>

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{localizeThread(error, language)}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p className="scripture-editor__loading">{t("pr.loading")}</p>
      ) : (
        <div className="scripture-editor__body">
          <p className="text-sm text-muted-foreground">
            {t("pr.explain")}
          </p>

          {!marker ? (
            <p className="text-sm text-muted-foreground">
              {t("pr.noneYet")}
            </p>
          ) : null}

          {files.length ? (
            <ul className="portion-review__files">
              {files.map((f) => (
                <li key={f.filename}>
                  <code>{f.filename}</code>
                  {f.status ? <span> · {f.status}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {diff ? (
            <pre className="portion-review__diff">{diff}</pre>
          ) : marker ? (
            <p className="text-sm text-muted-foreground">
              {t("pr.noChanges").replace("{draft}", draftLabel)}
            </p>
          ) : null}

          {marker ? (
            <div className="portion-review__comment">
              <Input
                placeholder={t("pr.commentPlaceholder")}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendComment();
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={acting || !comment.trim()}
                onClick={() => void sendComment()}
              >
                {t("pr.send")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

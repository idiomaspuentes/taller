import { useEffect, useMemo, useState } from "react";
import type { AssignmentsDoc, InventoryDoc, Team } from "../domain/types";
import { scopeLabel } from "../domain/resourceNames";
import type { GtSession } from "../dcs/auth";
import { DEFAULT_PM_CONFIG, displayOrgTeamName, type PmConfig } from "../domain/roles";
import {
  REVIEW_CANDIDATES_FALLBACK_NOTE,
  REVIEW_CREATE_ACTION,
  parseReviewRef,
  resolveReviewCandidates,
  reviewResources,
  reviewWorkOrders,
  type OrgTeamAccess,
  type ReviewCandidate,
} from "../domain/reviewTask";
import { tryReadOrgTeamAccess } from "../domain/teamEligibility";
import { createReviewIssues, loadPmConfig, reviewIssuesToast } from "../dcs/issues";
import { Button } from "@/components/ui/button";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";
import { localizeScope } from "../domain/scopeNames";
import { localizeName } from "../domain/templateNames";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { explainError } from "../dcs/userError";

type Props = {
  session: GtSession | null;
  pmOrg: string;
  board: AssignmentsDoc;
  team: Team;
  inventory: InventoryDoc | null;
  onChange: (next: AssignmentsDoc) => void;
  onCreated: () => void;
  announce: (msg: string) => void;
};

/**
 * Gestor: save the project plan, then create ONLY this review's subtarea for
 * its verses, assigned to one person who may edit the resource in DCS (org
 * team access), whether or not they are an integrante of a task. Does not
 * publish the rest of the plan.
 */
export function ReviewTaskControl({
  session,
  pmOrg,
  board,
  team,
  inventory,
  onChange,
  onCreated,
  announce,
}: Props) {
  const t = useT();
  const language = useUiLanguage();
  const loc = (text: string) => localizeThread(text, language);
  const [pmConfig, setPmConfig] = useState<PmConfig>(DEFAULT_PM_CONFIG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  /** `undefined` while reading DCS; `null` when it could not be read. */
  const [access, setAccess] = useState<OrgTeamAccess[] | null | undefined>(undefined);

  useEffect(() => {
    if (!session || !pmOrg) return;
    let cancelled = false;
    void loadPmConfig(session, pmOrg).then((config) => {
      if (!cancelled) setPmConfig(config);
    });
    setAccess(undefined);
    void tryReadOrgTeamAccess(session, pmOrg).then((rows) => {
      if (!cancelled) setAccess(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg]);

  const projectBooks = board.books?.length ? board.books : [board.book];
  const scope = parseReviewRef(team.reviewRef, projectBooks);
  const resources = reviewResources(team);
  const resourceNames = resources.map((r) => scopeLabel(r, board.settings?.resourceNames, language, (text) => localizeScope(text, language))).join(t("rt.and"));
  const signedIn = Boolean(session && pmOrg);
  const loading = signedIn && access === undefined;
  const { candidates, source } = useMemo(
    () => resolveReviewCandidates(board, team, signedIn ? access : null, pmConfig),
    [board, team, signedIn, access, pmConfig],
  );
  const assigneeId = team.reviewAssigneeId ?? "";
  const assigneeOk = candidates.some((c) => c.person.id === assigneeId);

  if (!team.reviewRef?.trim()) {
    return (
      <p className="phases-task__note">{t("rt.noRef")}</p>
    );
  }

  const planReason = reviewWorkOrders(board, team, inventory).reason;
  const blockReason =
    (planReason ? loc(planReason) : null) ||
    (!session || !pmOrg ? t("rt.signIn") : null) ||
    (loading ? t("rt.searching").replace("{res}", resourceNames || t("rt.thisResource")) : null) ||
    (!candidates.length
      ? source === "permisos"
        ? t("rt.nobodyOrg").replace("{res}", resourceNames || t("rt.thisResource"))
        : t("rt.nobodyProject").replace("{res}", resourceNames || t("rt.thisResource")).replace("{that}", resourceNames || t("rt.thatResource"))
      : null) ||
    (!assigneeOk ? t("rt.pickWho") : null);

  function pickAssignee(id: string) {
    setMessage("");
    const picked = candidates.find((c) => c.person.id === id)?.person;
    const known = board.people.some((p) => p.id.toLowerCase() === id.toLowerCase());
    onChange({
      ...board,
      people: picked && !known ? [...board.people, picked] : board.people,
      teams: board.teams.map((t) => (t.id === team.id ? { ...t, reviewAssigneeId: id } : t)),
    });
  }

  function candidateDetail(c: ReviewCandidate): string {
    if (c.teams?.length) {
      return c.teams.map((name) => displayOrgTeamName(name, pmConfig.teamPrefix)).join(", ");
    }
    return c.via.map((v) => (v.phaseName ? `${localizeName(v.taskName, language)} (${localizeName(v.phaseName, language)})` : localizeName(v.taskName, language))).join(", ");
  }

  async function create() {
    if (!session || !pmOrg) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await createReviewIssues({ session, org: pmOrg, board, task: team, inventory });
      const text = loc(reviewIssuesToast(result));
      setMessage(text);
      announce(text);
      onCreated();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  const selectId = `review-assignee-${team.id}`;
  return (
    <div className="grid gap-1.5">
      <p className="phases-task__note">
        {scope.ok ? `${t("rt.reviewOf").replace("{display}", scope.display)}${resourceNames ? ` · ${resourceNames}` : ""}` : loc(scope.reason)}
      </p>
      {candidates.length || loading ? (
        <div className="grid gap-1">
          <Label htmlFor={selectId} className="text-xs">
            {t("rt.whoReviews")}
          </Label>
          <Select value={assigneeOk ? assigneeId : ""} onValueChange={pickAssignee} disabled={loading}>
            <SelectTrigger id={selectId} className="w-full max-w-sm" aria-label={t("rt.whoReviews")}>
              <SelectValue placeholder={t("rt.pickPerson")} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.person.id} value={c.person.id}>
                  {c.person.name} · {candidateDetail(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {assigneeId && !assigneeOk && !loading ? (
            <p className="phases-task__note">
              {t("rt.staleAssignee").replace("{res}", resourceNames)}
            </p>
          ) : null}
        </div>
      ) : null}
      {session && pmOrg && access === null ? (
        <p className="phases-task__note">{loc(REVIEW_CANDIDATES_FALLBACK_NOTE)}</p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={Boolean(blockReason) || busy}
        aria-describedby={blockReason ? `review-create-${team.id}` : undefined}
        onClick={() => void create()}
      >
        {busy ? t("rt.creating") : loc(REVIEW_CREATE_ACTION)}
      </Button>
      {blockReason ? (
        <p id={`review-create-${team.id}`} className="phases-task__note">
          {blockReason}
        </p>
      ) : (
        <p className="phases-task__note">
          {t("rt.hint")}
        </p>
      )}
      {message ? <p className="phases-task__note">{message}</p> : null}
      {error ? <p className="phases-task__note text-destructive">{loc(error)}</p> : null}
    </div>
  );
}

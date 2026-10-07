import { projectFromMilestone } from "../domain/scope";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import { claimIssue, listTeamOpenIssues } from "../dcs/issues";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { projectAllowsSelfAssign } from "../domain/store";
import { parseWorkOrderMarker } from "../domain/workOrder";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { subtaskName } from "../domain/noticeText";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { explainError } from "../dcs/userError";

type Props = {
  session: GtSession;
  pmOrg: string;
  orgTeam: string;
  lang: string;
  contentOrg: string;
  announce: (msg: string) => void;
};

export function TeamBoardView({
  session,
  pmOrg,
  orgTeam,
  lang,
  contentOrg,
  announce,
}: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [issues, setIssues] = useState<DcsIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<number | null>(null);
  /** projectId → allowSelfAssign */
  const [allowByProject, setAllowByProject] = useState<Record<string, boolean>>({});

  const isMember = useMemo(() => {
    return (session.teams ?? []).some(
      (t) => t.organization?.name === pmOrg && t.name === orgTeam,
    );
  }, [session.teams, pmOrg, orgTeam]);

  const reload = useCallback(async () => {
    if (!pmOrg || !orgTeam) {
      setIssues([]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const open = await listTeamOpenIssues(session, pmOrg, orgTeam);
      setIssues(open);
      const ids = [
        ...new Set(
          open
            .map((issue) => projectFromMilestone(issue.milestone?.title) || parseWorkOrderMarker(issue.body)?.book || "")
            .filter(Boolean),
        ),
      ];
      const next: Record<string, boolean> = {};
      await Promise.all(
        ids.map(async (projectId) => {
          const doc = await loadAssignmentsFromDcs(
            session,
            pmOrg,
            lang,
            projectId,
            contentOrg,
          );
          next[projectId.toUpperCase()] = doc ? projectAllowsSelfAssign(doc) : false;
        }),
      );
      setAllowByProject(next);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [session, pmOrg, orgTeam, lang, contentOrg]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function take(issue: DcsIssue) {
    if (!isMember) {
      setError(t("tb.onlyMembers"));
      return;
    }
    const projectId = (
      projectFromMilestone(issue.milestone?.title) ||
      parseWorkOrderMarker(issue.body)?.book ||
      ""
    ).toUpperCase();
    if (projectId && !allowByProject[projectId]) {
      setError(t("tb.noSelfError"));
      return;
    }
    setActing(issue.number);
    try {
      await claimIssue(session, pmOrg, issue.number);
      announce(t("tb.took").replace("{n}", subtaskName(issue, language)));
      await reload();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="grid gap-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("tb.title").replace("{team}", orgTeam)}</CardTitle>
          <CardDescription>
            {t("tb.unassigned").replace("{org}", pmOrg)}{" "}
            {isMember ? t("tb.canTake") : t("tb.notMember")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>
            {busy ? t("tb.loading") : t("tb.refresh")}
          </Button>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {!busy && !issues.length ? (
            <p className="text-sm text-muted-foreground">{t("tb.empty")}</p>
          ) : null}
          {issues.map((issue) => {
            const marker = parseWorkOrderMarker(issue.body);
            const projectId = (
              projectFromMilestone(issue.milestone?.title) ||
              marker?.book ||
              ""
            ).toUpperCase();
            const allowed = !projectId || allowByProject[projectId] === true;
            return (
              <div key={issue.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <a
                    className="font-medium hover:underline"
                    href={issue.html_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    #{issue.number} · {issue.title}
                  </a>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {issue.milestone?.title ? <Badge variant="outline">{issue.milestone.title}</Badge> : null}
                    {marker?.resource ? <Badge variant="secondary">{marker.resource}</Badge> : null}
                    {projectId && allowByProject[projectId] === false ? (
                      <Badge variant="outline">{t("tb.noSelf")}</Badge>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!isMember || !allowed || acting === issue.number}
                  onClick={() => void take(issue)}
                >
                  {t("tb.take")}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

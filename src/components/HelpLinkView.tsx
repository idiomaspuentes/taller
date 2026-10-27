import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { resolveHelpLink } from "../dcs/helpLink";
import { explainError } from "../dcs/userError";
import type { HelpLink } from "../domain/helpLink";
import { useT } from "../i18n/messages";
import { LoadingState } from "./LoadingState";

/**
 * A short link to a help, sent by somebody of the team (see `helpLink.ts`): it opens the tool of that step on that
 * help, for whoever opens it. Nothing to do here but wait, or go to the tasks when the link leads nowhere.
 */
export function HelpLinkView(props: { link: HelpLink; session: GtSession; space: { pmOrg: string; lang: string; contentOrg: string }; onTasks: () => void }) {
  const t = useT();
  const [error, setError] = useState("");
  const { link, session, space } = props;
  useEffect(() => {
    let live = true;
    // A link of another team space would be read with this one's language and organizations.
    if (link.org.toLowerCase() !== space.pmOrg.toLowerCase()) {
      setError(t("hl.otherSpace").replace("{org}", link.org));
      return;
    }
    resolveHelpLink(session, link, space)
      .then((url) => {
        if (live) window.location.replace(url);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error && err.message === "missing" ? t("hl.missing") : explainError(err));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.org, link.project, link.issue, link.step, link.item, session.token, space.pmOrg]);

  if (!error) return <LoadingState shape="tool" label={t("hl.opening")} />;
  return (
    <div className="hl-error">
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
      <Button type="button" size="lg" onClick={props.onTasks}>
        {t("hl.toTasks")}
      </Button>
    </div>
  );
}

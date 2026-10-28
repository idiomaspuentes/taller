import { CheckCheck, PencilLine } from "lucide-react";
import type { NoteSituation } from "../domain/noteSituation";
import { useT } from "../i18n/messages";
import { RosterFace } from "./ChapterHelpsList";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Where a step of a note stands, in one line under its steps (Abel, 27 October): whether this person opens it or
 * collaborates on what somebody said, with the faces of who did, and who is still missing. It was a count («1/3»)
 * under each question and a box at the foot of the note.
 */
export function SituationLine({ situation, people, me, nameOf, answered }: {
  situation: NoteSituation;
  /** How many people decide the list. */
  people: number;
  me: string;
  nameOf: (login: string) => string;
  /** This person wrote on the note before: what was asked is an answer to them. */
  answered?: boolean;
}) {
  const t = useT();
  const names = (list: string[]) => {
    const all = list.map(nameOf);
    return all.length < 2 ? (all[0] ?? "") : t("ck.sitAnd").replace("{a}", all.slice(0, -1).join(", ")).replace("{b}", all[all.length - 1]!);
  };
  // Who is still missing: the team less those who are in already; this person among them unless they are in.
  const missing = (inAlready: string[]) => {
    const others = inAlready.filter((who) => !same(who, me)).length;
    const meIn = inAlready.some((who) => same(who, me));
    const rest = Math.max(0, people - others - 1);
    if (meIn) return rest > 0 ? t("ck.sitMissingOthers").replace("{n}", String(rest)) : "";
    return rest > 0 ? t("ck.sitMissing").replace("{n}", String(rest)) : t("ck.sitMissingYou");
  };
  const agreedLine = (agreed: string[]) => (agreed.length ? t(agreed.length > 1 ? "ck.sitAgreed" : "ck.sitAgreedOne").replace("{who}", names(agreed)) : "");
  const doubtLine = (doubts: string[]) => (doubts.length ? t("ck.sitDoubt").replace("{who}", names(doubts)) : "");

  let faces: string[] = [];
  let parts: string[] = [];
  switch (situation.kind) {
    case "first":
      parts = [t("ck.sitFirst")];
      break;
    case "confirm":
      faces = situation.by;
      parts = [t(situation.by.length > 1 ? "ck.sitConfirmMany" : "ck.sitConfirm").replace("{who}", names(situation.by)), missing(situation.by)];
      break;
    case "proposal": {
      const agreed = situation.agreed.filter((who) => !same(who, me));
      faces = [situation.author, ...agreed.filter((who) => !same(who, situation.author))];
      parts = [agreed.length ? agreedLine(agreed) : t("ck.sitProposal").replace("{who}", nameOf(situation.author)), doubtLine(situation.doubts), missing(situation.agreed)];
      break;
    }
    case "ownProposal": {
      const agreed = situation.agreed.filter((who) => !same(who, me));
      faces = agreed;
      parts = [t("ck.sitOwn"), agreedLine(agreed), doubtLine(situation.doubts), missing(situation.agreed)];
      break;
    }
    case "agreedApart":
      parts = [t("ck.agreedApart")];
      break;
    case "asked":
      faces = [situation.by];
      parts = [t(answered ? "ck.sitAnswered" : "ck.sitAsked").replace("{who}", nameOf(situation.by))];
      break;
    default:
      return null;
  }
  return (
    <p className="ck-sit" data-kind={situation.kind}>
      <span className="ck-sit__faces" aria-hidden="true">
        {faces.length ? faces.map((login) => <RosterFace key={login} login={login} name={nameOf(login)} now={false} />) : situation.kind === "agreedApart" ? <CheckCheck size={18} /> : <PencilLine size={18} />}
      </span>
      <span className="ck-sit__text">{parts.filter(Boolean).join(" ")}</span>
    </p>
  );
}

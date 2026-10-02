import type { ChecklistQuestion } from "./types";

/**
 * «Aval»: a committee decides on a unit. Each member reads it on their own and hands in a report: an answer to each
 * question the process asks, and their concerns. Nobody sees another report before handing in their own, so each
 * judgement is independent. Then the committee decides. The questions and the rule come from the template.
 */

/** A concern of a member: an observation, or an objection that the committee must look at before deciding. */
export type Concern = {
  id: string;
  kind: "observation" | "objection";
  /** Where: a verse of the unit, or empty for the whole of it. */
  where?: string;
  /** What it is about, so it reaches whoever maintains it (a resource of the process). */
  about: string;
  text: string;
  /** The member took it back, or says it was answered. */
  withdrawn?: boolean;
};

export type EndorsementReport = {
  by: string;
  /** Question id → supports it or not. */
  answers: Record<string, boolean>;
  concerns: Concern[];
  /** Handed in: it counts, and the member can now see the others. */
  delivered: boolean;
  at: string;
};

/** How the committee decides when its members do not all agree. */
export type EndorsementRule = "majority" | "unanimous";

export type EndorsementTally = {
  delivered: EndorsementReport[];
  /** Members who support the unit: every question answered yes and no objection of their own standing. */
  supporters: string[];
  /** Objections still standing, from anybody. */
  objections: (Concern & { by: string })[];
  observations: (Concern & { by: string })[];
  /** Everybody who handed in supports it and no objection stands. */
  consensus: boolean;
  /** The rule is met, so the endorsement may be granted. */
  canEndorse: boolean;
  /** Why it may not, for the screen. */
  blocker: "none" | "few-reports" | "no-majority" | "objections";
};

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What a member may see: their own report always; the others only after handing in their own. */
export function visibleReports(reports: EndorsementReport[], viewer: string): EndorsementReport[] {
  const mine = reports.find((report) => same(report.by, viewer));
  if (!mine?.delivered) return mine ? [mine] : [];
  return reports.filter((report) => report.delivered || same(report.by, viewer));
}

function supports(report: EndorsementReport, questions: ChecklistQuestion[]): boolean {
  return questions.every((question) => report.answers[question.id] === true) && !report.concerns.some((c) => c.kind === "objection" && !c.withdrawn);
}

/**
 * Where the decision stands.
 * - With two members, both must support it. With three or more, more than half (`majority`), or all (`unanimous`).
 * - An objection is put before the whole committee: while one stands the committee is not in consensus, and under
 *   `unanimous` it blocks. Under `majority` the committee may still decide by majority once everybody has seen it.
 */
export function tallyEndorsement(params: { reports: EndorsementReport[]; questions: ChecklistQuestion[]; minMembers: number; rule: EndorsementRule }): EndorsementTally {
  const delivered = params.reports.filter((report) => report.delivered);
  const supporters = delivered.filter((report) => supports(report, params.questions)).map((report) => report.by);
  const all = delivered.flatMap((report) => report.concerns.filter((c) => !c.withdrawn).map((c) => ({ ...c, by: report.by })));
  const objections = all.filter((c) => c.kind === "objection");
  const observations = all.filter((c) => c.kind === "observation");
  const consensus = delivered.length > 0 && supporters.length === delivered.length && objections.length === 0;
  let blocker: EndorsementTally["blocker"] = "none";
  if (delivered.length < Math.max(2, params.minMembers)) blocker = "few-reports";
  else if (delivered.length === 2 || params.rule === "unanimous") blocker = consensus ? "none" : objections.length ? "objections" : "no-majority";
  else if (supporters.length * 2 <= delivered.length) blocker = "no-majority";
  return { delivered, supporters, objections, observations, consensus, canEndorse: blocker === "none", blocker };
}

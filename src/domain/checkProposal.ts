import type { CheckAnswer } from "./checklist";
import type { CorrectionAsk } from "./corrections";
import { scopeKey } from "./scope";
import { ADJUSTMENT_SAYS, SINGLE_PROPOSAL_FROM, optionsAndAdjustments } from "./singleProposal";

/**
 * A change proposed while checking: a «no» is settled by saying what should change, with the new version written
 * out or with a comment, and nothing changes until the team agrees. A team checked its helps by answering «no»
 * and then changing them in another screen, at once; its agreement came afterwards, over a line of what was said
 * to have changed, with neither the old words nor the new ones in sight. And it could say nothing of an article.
 *
 * A proposal about something the team maintains is applied when enough of the team agrees. One about something
 * another team maintains (a text, from a team that checks helps against it) goes to that team as a correction, as
 * what a committee does not endorse does. Nothing here knows which resources those are.
 *
 * Proposals live with the answers of the checklist, one file per person that is only added to: a proposal is the
 * answer that settles a «no», and what others say of it are rows that name it.
 */

export type ProposalPayload = {
  id: string;
  /** What it would change, as the project names its resources. */
  resource: string;
  /** Which part of a help with more than one (`Question`, `Response`): the column it is written in. */
  field?: string;
  /** The file of an article, when that is what would change. */
  path?: string;
  /** The row of the help, when that is what would change. */
  rowId?: string;
  /** Where in the passage («1:3»). */
  where: string;
  /** The words as they were when it was proposed. */
  before?: string;
  /** The new version. Without one the proposal is a comment: what should change, said in `note`. */
  after?: string;
  /** The proposal this one answers with another version. */
  replaces?: string;
  /** An adjustment to somebody else's proposal (see `singleProposal`): the version of it it was written over. */
  suggests?: string;
  /** A version that takes an adjustment: the adjustment, and who suggested it. */
  accepts?: string;
  adjustedBy?: string;
  /** The help does not exist yet: `after` is a new row of that file, with `rowId` for its id, at `where`. */
  add?: true;
  /**
   * What else that new row says: the words of the original it is about (`Quote`, `Occurrence`). Of a note parted
   * in two, what else the note that stays says: the words it is about now.
   */
  fields?: Record<string, string>;
  /** Those words as they read in the text they were marked in, to say what the new help (or the half that stays) is about. */
  about?: string;
  /**
   * The note is parted in two: `after` is what stays in it, and this is the new note the rest goes to, a row added
   * beside it. One proposal and not two, so the team agrees on both or on neither: the note cut short without
   * the new one would lose what was taken out of it.
   */
  split?: {
    rowId: string;
    after: string;
    fields?: Record<string, string>;
    about?: string;
    /** The other new notes, when the note is parted in more than two (26 October), each after the one before. */
    more?: { rowId: string; after: string; fields?: Record<string, string>; about?: string }[];
  };
};

/**
 * Something somebody writes in the conversation of an item (21 October): `itemId` is the item, `note` what they
 * wrote. It answers no question: it is read with the rest of what the team said of the item.
 */
export const ITEM_SAYS = "@conversacion";

/** What somebody writes in the conversation of an item: of one of its options (`about`), when it has them. */
export function itemSaying(itemId: string, by: string, at: string, text: string, about?: string): CheckAnswer {
  return { itemId, questionId: ITEM_SAYS, value: "yes", note: text.trim(), by, at, ...(about ? { about } : {}) };
}

/** The option of leaving an item as it is, among the proposals made for it. */
export const KEEP_OPTION = "keep";

/** A row somebody adds about a proposal: `itemId` is the id of the proposal. */
export const PROPOSAL_SAYS = "@acuerdo";
/** The row that says a proposal was carried out: applied to the team's help, or sent to the team that maintains it. */
export const PROPOSAL_DONE = "@hecha";
/** The question a proposal answers when it is about no question of the step: something seen in passing. */
export const PROPOSAL_FREE = "@propuesta";
/**
 * A row by which somebody says they would rather leave things as they are. There was no way to be against a
 * proposal but to write another one: a team that did not want a change could not say so, and the proposal stayed
 * to be resolved, with the step it kept open, until its author took it back.
 */
export const PROPOSAL_KEEPS = "@dejar";
/**
 * The row by which whoever coordinates the team settles a proposal the team could not agree on (21 October): «yes»
 * carries it out, «no» leaves things as they are. It counts only where the team decides by agreement of all, and only
 * from somebody `decides` lets decide.
 */
export const PROPOSAL_DECIDED = "@decide";
/** How long a team may go on disagreeing about a proposal before whoever coordinates it can settle it. */
export const DISPUTE_DAYS = 3;

export type ProposalState = "open" | "agreed" | "applied" | "sent" | "withdrawn" | "replaced" | "rejected";

export type ProposalView = {
  proposal: ProposalPayload;
  itemId: string;
  questionId: string;
  by: string;
  at: string;
  /** Why: the question it failed, or what the person wrote. */
  reason: string;
  /** Who is for it, its author first. */
  inFavour: string[];
  /** Who would rather leave things as they are. */
  against: string[];
  state: ProposalState;
  /** The subtarea it became, when it was sent to another team. */
  sentAs?: string;
  /** Since when some are for it and some would rather leave things as they are, while that lasts. */
  disputedSince?: string;
  /** Who settled it for the team, when the team could not agree on it. */
  decidedBy?: string;
  /**
   * Decided by agreement of all, each proposal of an item is one of its options (21 October): the id of its first
   * version, which stays its id as it is edited; what each person chose for the item, by their name in lower case
   * (`KEEP_OPTION`, or the id of an option); and who chose this one before its last version, to look at it again.
   */
  option?: string;
  choices?: Record<string, string>;
  staleFor?: string[];
  /**
   * An adjustment to one option of the item, by that option's id (27 October): not an option itself, and nobody
   * chooses it. How it stands: waiting for the option's author, taken into the option, not accepted (and by whom), or
   * written over a version the option no longer is.
   */
  adjusts?: string;
  adjustment?: "pending" | "accepted" | "declined" | "stale";
  declinedBy?: string;
  /**
   * Checked with the step's questions (see `ProposalRule.questionsOf`): what each person (in lower case) marked of
   * this version, who says «no» to it (as they write their name), and the questions its author proposed it from,
   * which count as their «yes».
   */
  marks?: Record<string, Record<string, "yes" | "no">>;
  noBy?: string[];
  origin?: string[];
};

/**
 * How a team decides on proposals. By default, as many as `needed` decide: that many for it, or all but one against.
 * By agreement of all (`consensus`, 21 October: «no se siente bien que gane el que tenga más votos sin que haya un
 * acuerdo final»), a proposal is agreed when `needed` are for it and nobody against, and left aside only when all who
 * spoke, its author too, would rather leave things as they are; meanwhile it stays open, and the team talks it over,
 * adjusts it or proposes something else. If that goes on, whoever `decides` may settle it.
 */
export type ProposalRule = {
  consensus?: boolean;
  decides?: (login: string) => boolean;
  /**
   * The questions a version is checked with (27 October): choosing it is marking «yes» on all of them. Without it a
   * proposal is chosen by proposing it or by being for it, as before.
   */
  questionsOf?: (view: ProposalView) => string[];
};

/** The proposal is in dispute long enough for whoever coordinates the team to settle it. */
export function disputeStalled(view: Pick<ProposalView, "disputedSince" | "state">, now: number = Date.now()): boolean {
  return view.state === "open" && Boolean(view.disputedSince) && now - Date.parse(view.disputedSince!) >= DISPUTE_DAYS * 86_400_000;
}

/** The row by which whoever coordinates the team settles a proposal: carried out (`apply`) or left aside. */
export function proposalDecided(proposalId: string, by: string, at: string, apply: boolean): CheckAnswer {
  return { itemId: proposalId, questionId: PROPOSAL_DECIDED, value: apply ? "yes" : "no", by, at };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The answer that settles a «no» with a proposal. */
export function proposalAnswer(params: { itemId: string; questionId: string; by: string; at: string; reason: string; proposal: ProposalPayload; textHash?: string }): CheckAnswer {
  return { itemId: params.itemId, questionId: params.questionId, value: "no", outcome: "proposal", note: params.reason.trim(), proposal: params.proposal, by: params.by, at: params.at, ...(params.textHash ? { textHash: params.textHash } : {}) };
}

/** What a person says of a proposal: for it, or (its author) taking it back. */
export function proposalSaying(proposalId: string, by: string, at: string, agree: boolean): CheckAnswer {
  return { itemId: proposalId, questionId: PROPOSAL_SAYS, value: agree ? "yes" : "no", by, at };
}

/** What a person says of leaving things as they are instead of a proposal: that they would, or no longer. */
export function proposalKeeping(proposalId: string, by: string, at: string, keep: boolean): CheckAnswer {
  return { itemId: proposalId, questionId: PROPOSAL_KEEPS, value: keep ? "yes" : "no", by, at };
}

/** The row that says a proposal was carried out, and as what (the subtarea it became, when it went to another team). */
export function proposalDone(proposalId: string, by: string, at: string, sentAs?: string): CheckAnswer {
  return { itemId: proposalId, questionId: PROPOSAL_DONE, value: "yes", by, at, ...(sentAs ? { note: sentAs } : {}) };
}

/** How many people besides its author a proposal takes, to be agreed on or to be left aside. */
export const othersNeeded = (needed: number): number => Math.max(1, needed - 1);

/**
 * The proposals among some answers, and how each stands. `needed`: how many people have to be for one, its author
 * among them, for it to be agreed. As many besides its author as that takes who would rather leave things as they
 * are, and it is not accepted: a change needs the team's agreement, and without it things stay as they are. It
 * took `needed` people to leave it, which a team of two never has besides the author: there one person proposed,
 * the other did not want it, and it stayed to be resolved until the first took it back.
 * `ours`: whether the team maintains what a proposal would change; one it does not is «sent» once carried out,
 * not «applied».
 */
export function proposalsOf(answers: CheckAnswer[], needed: number, ours: (resource: string) => boolean = () => true, rule: ProposalRule = {}): ProposalView[] {
  const byTime = [...answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // One proposal may answer several questions that failed (it makes sense with the TPL, and it is useful, say): it is
  // one proposal, the first answer that carries it (20 October).
  const seen = new Set<string>();
  const made = byTime.filter((row) => row.outcome === "proposal" && row.proposal?.id && !seen.has(row.proposal.id) && Boolean(seen.add(row.proposal.id)));
  // A version its author took back replaces nothing: the one it adjusted is the proposal again (21 October).
  const takenBack = new Set(made.filter((row) => byTime.filter((other) => other.itemId === row.proposal!.id && other.questionId === PROPOSAL_SAYS && same(other.by, row.by)).pop()?.value === "no").map((row) => row.proposal!.id));
  const replaced = new Set(made.flatMap((row) => (row.proposal!.replaces && !takenBack.has(row.proposal!.id) ? [row.proposal!.replaces] : [])));
  const views: ProposalView[] = made.map((row) => {
    const proposal = row.proposal!;
    // The last thing each person said of it: for it, for leaving things as they are, or neither any more.
    const said = new Map<string, { by: string; at: string; stand: "for" | "against" | "none" }>();
    let withdrawn = false;
    // By agreement of all its author may come round to leaving things as they are, and say so.
    let authorKeeps: string | undefined;
    for (const other of byTime) {
      if (other.itemId !== proposal.id || (other.questionId !== PROPOSAL_SAYS && other.questionId !== PROPOSAL_KEEPS)) continue;
      const yes = other.value === "yes";
      // Its author is for it while it stands: what they can say is that they take it back.
      if (same(other.by, row.by)) {
        if (other.questionId === PROPOSAL_SAYS) withdrawn = !yes;
        else if (rule.consensus) authorKeeps = yes ? other.at : undefined;
        continue;
      }
      const stand = !yes ? "none" : other.questionId === PROPOSAL_SAYS ? "for" : "against";
      const was = said.get(other.by.trim().toLowerCase());
      said.set(other.by.trim().toLowerCase(), { by: other.by, at: was?.stand === stand ? was.at : other.at, stand });
    }
    const standing = (stand: "for" | "against") => [...said.values()].filter((line) => line.stand === stand);
    const inFavour = [...(authorKeeps ? [] : [row.by]), ...standing("for").map((line) => line.by)];
    const against = [...(authorKeeps ? [row.by] : []), ...standing("against").map((line) => line.by)];
    const done = byTime.filter((other) => other.questionId === PROPOSAL_DONE && other.itemId === proposal.id).pop();
    const decision = rule.consensus && rule.decides ? byTime.filter((other) => other.questionId === PROPOSAL_DECIDED && other.itemId === proposal.id && rule.decides!(other.by)).pop() : undefined;
    const agreed = rule.consensus ? inFavour.length >= Math.max(1, needed) && !against.length : inFavour.length >= Math.max(1, needed);
    const left = rule.consensus ? !inFavour.length && against.length >= Math.max(1, needed) : against.length >= othersNeeded(needed);
    const state: ProposalState = withdrawn
      ? "withdrawn"
      : replaced.has(proposal.id)
        ? "replaced"
        : done
          ? ours(proposal.resource)
            ? "applied"
            : "sent"
          : decision
            ? decision.value === "yes"
              ? "agreed"
              : "rejected"
            : left
              ? "rejected"
              : agreed
                ? "agreed"
                : "open";
    // The dispute began when both sides stood: the later of the first «for» (the proposal itself, while its author
    // stands by it) and the first «against».
    const firstAt = (lines: { at: string }[]) => lines.map((line) => line.at).sort()[0];
    const forSince = authorKeeps ? firstAt(standing("for")) : row.at;
    const againstSince = firstAt([...(authorKeeps ? [{ at: authorKeeps }] : []), ...standing("against")]);
    const disputedSince = rule.consensus && state === "open" && inFavour.length && against.length && forSince && againstSince ? [forSince, againstSince].sort()[1] : undefined;
    return {
      proposal,
      itemId: row.itemId,
      questionId: row.questionId,
      by: row.by,
      at: row.at,
      reason: row.note ?? "",
      inFavour: withdrawn ? [] : inFavour,
      against: withdrawn ? [] : against,
      state,
      ...(done?.note ? { sentAs: done.note } : {}),
      ...(disputedSince ? { disputedSince } : {}),
      ...(decision && !done && !withdrawn && !replaced.has(proposal.id) ? { decidedBy: decision.by } : {}),
    };
  });
  return rule.consensus ? byChoice(views, byTime, needed, rule) : views;
}

/**
 * Decided by agreement of all, the proposals for an item are options, with leaving it as it is (Abel, 21 October:
 * somebody may think a simpler change than the one proposed solves it, and propose it from the note as it is). Each
 * person chooses one: by proposing it or editing it, by being for it, or by saying the item is right or would rather
 * leave it as it is; what they said last is their choice. The item is settled when at least `needed` chose and all of
 * them chose the same; or when whoever coordinates the team decides, once the team could not agree.
 */
function byChoice(views: ProposalView[], byTime: CheckAnswer[], needed: number, rule: ProposalRule): ProposalView[] {
  const byId = new Map(views.map((view) => [view.proposal.id, view]));
  const rootOf = (id: string): string => {
    const seen = new Set<string>();
    let at = byId.get(id);
    while (at?.proposal.replaces && byId.has(at.proposal.replaces) && !seen.has(at.proposal.id)) {
      seen.add(at.proposal.id);
      at = byId.get(at.proposal.replaces);
    }
    return at?.proposal.id ?? id;
  };
  const heads = views.filter((view) => view.state !== "replaced" && view.state !== "withdrawn");
  const out = new Map<string, ProposalView>(views.map((view) => [view.proposal.id, { ...view, option: rootOf(view.proposal.id) }]));
  for (const itemId of new Set(views.map((view) => view.itemId))) {
    const group = views.filter((view) => view.itemId === itemId);
    const headOf = (root: string) => heads.find((view) => view.itemId === itemId && rootOf(view.proposal.id) === root);
    const chainOf = (root: string) => group.filter((view) => rootOf(view.proposal.id) === root);
    // Who did not accept an adjustment, when it was the author of the option it adjusts or whoever coordinates.
    const declinedBy = (root: string, option: string): string | undefined => {
      const versions = new Set(chainOf(root).map((view) => view.proposal.id));
      const last = byTime.filter((row) => row.questionId === ADJUSTMENT_SAYS && versions.has(row.itemId)).pop();
      return last?.value === "no" && (same(last.by, byId.get(option)?.by ?? "") || rule.decides?.(last.by)) ? last.by : undefined;
    };
    // One proposal per item (27 October): what else is written about it adjusts it (see `singleProposal`).
    const roots = group.filter((view) => !view.proposal.replaces || !byId.has(view.proposal.replaces)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    // A proposal stands while it is neither taken back nor carried out, nor left aside by whoever coordinates: one
    // written after it was applied is another proposal, not an adjustment to what is done.
    const standing = (root: string) => {
      const head = headOf(root);
      return Boolean(head) && head!.state !== "applied" && head!.state !== "sent" && !(head!.state === "rejected" && head!.decidedBy);
    };
    const declinedRoot = (root: string) => Boolean(declinedBy(root, rootOf(byId.get(root)!.proposal.suggests ?? root)));
    // Only proposals about the same words are one proposal: a change of the text and one of the note are two.
    const about = (view: ProposalView) => `${view.proposal.resource}\u0000${proposalWords(view.proposal)}`;
    const options: string[] = [];
    const adjusts = new Map<string, string>();
    for (const key of new Set(roots.map(about))) {
      const found = optionsAndAdjustments(roots.filter((root) => about(root) === key), standing, rootOf, declinedRoot);
      options.push(...found.options);
      for (const [root, option] of found.adjusts) adjusts.set(root, option);
    }
    const adjusting = new Set(group.filter((view) => adjusts.has(rootOf(view.proposal.id))).map((view) => view.proposal.id));
    const ids = new Set(group.map((view) => view.proposal.id).filter((id) => !adjusting.has(id)));
    const live = new Map(options.map((root) => [root, headOf(root)!]));
    // The questions the proposals answer: saying one of them is right is choosing to leave the item as it is.
    const asked = new Set(byTime.filter((row) => row.outcome === "proposal" && row.proposal && ids.has(row.proposal.id)).map((row) => `${row.itemId}\u0000${row.questionId}`));
    const choice = new Map<string, { option: string; version?: string }>();
    let since: string | undefined;
    const distinct = () => new Set([...choice.values()].map((one) => one.option).filter((option) => option === KEEP_OPTION || live.has(option))).size;
    let decision: CheckAnswer | undefined;
    // Checked with the step's questions (27 October): each person's marks, by version and question, as the reading goes.
    const asks = rule.questionsOf;
    const marked = new Map<string, Map<string, Map<string, "yes" | "no">>>();
    const authorOf = (version: string) => byId.get(rootOf(version))?.by ?? "";
    const originOf = (version: string) => [...new Set(byTime.filter((row) => row.outcome === "proposal" && row.proposal && rootOf(row.proposal.id) === rootOf(version) && same(row.by, authorOf(version)) && !row.questionId.startsWith("@")).map((row) => row.questionId))];
    /**
     * What counts of what somebody marked, for a version: what they marked of it; and, for its author, what they
     * marked of the versions before it that they changed themselves. Another person's change (an adjustment they
     * took) asks everybody again.
     */
    const effective = (who: string, version: string): Map<string, "yes" | "no"> => {
      const out = new Map<string, "yes" | "no">();
      const versions = versionsOf(views, version);
      const author = same(authorOf(version), who);
      for (let i = versions.length - 1; i >= 0; i--) {
        const view = versions[i]!;
        for (const [qid, value] of marked.get(who)?.get(view.proposal.id) ?? []) if (!out.has(qid)) out.set(qid, value);
        if (!author || !same(view.by, who) || view.proposal.accepts) break;
      }
      return out;
    };
    const complete = (who: string, version: string) => {
      const view = byId.get(version);
      if (!asks || !view) return false;
      const marks = effective(who, version);
      const own = same(authorOf(version), who) ? originOf(version) : [];
      return asks(view).every((qid) => marks.get(qid) === "yes" || own.includes(qid));
    };
    const saysNo = (who: string, version: string) => [...effective(who, version).values()].includes("no");
    // The version of each option in force at this point of the reading, and who says «no» to which version.
    const inForce = new Map<string, string>();
    const noOn = new Map<string, string>();
    const weigh = (who: string, version: string, wrote = false) => {
      const option = rootOf(version);
      if (complete(who, version)) choice.set(who, { option, version });
      // Whoever writes a version is no longer for leaving the help as it is, nor for an older version of it.
      else if (wrote || choice.get(who)?.version === version) choice.delete(who);
      if (saysNo(who, version)) noOn.set(who, version);
      else if (noOn.get(who) === version) noOn.delete(who);
    };
    const anyNo = () => [...noOn.values()].some((version) => inForce.get(rootOf(version)) === version && live.has(rootOf(version)));
    for (const row of byTime) {
      const who = row.by.trim().toLowerCase();
      // An adjustment, and what is said of it, chooses nothing.
      if (adjusting.has(row.outcome === "proposal" && row.proposal ? row.proposal.id : row.itemId)) continue;
      if (row.outcome === "proposal" && row.proposal && ids.has(row.proposal.id) && row.itemId === itemId) {
        inForce.set(rootOf(row.proposal.id), row.proposal.id);
        // Written since proposals are checked, a version is chosen by its writer once they checked it all.
        if (asks && row.at >= SINGLE_PROPOSAL_FROM) weigh(who, row.proposal.id, true);
        else choice.set(who, { option: rootOf(row.proposal.id), version: row.proposal.id });
      } else if (asks && ids.has(row.itemId) && !row.questionId.startsWith("@")) {
        const mine = marked.get(who) ?? new Map<string, Map<string, "yes" | "no">>();
        const on = mine.get(row.itemId) ?? new Map<string, "yes" | "no">();
        if (row.cleared) on.delete(row.questionId);
        else on.set(row.questionId, row.value);
        mine.set(row.itemId, on);
        marked.set(who, mine);
        weigh(who, row.itemId);
      } else if (ids.has(row.itemId) && row.questionId === PROPOSAL_SAYS) {
        const view = byId.get(row.itemId)!;
        if (row.value === "yes") choice.set(who, { option: rootOf(row.itemId), version: row.itemId });
        else if (!same(view.by, row.by) && choice.get(who)?.option === rootOf(row.itemId)) choice.delete(who);
      } else if (ids.has(row.itemId) && row.questionId === PROPOSAL_KEEPS) {
        if (row.value === "yes") choice.set(who, { option: KEEP_OPTION });
        else if (choice.get(who)?.option === KEEP_OPTION) choice.delete(who);
      } else if (ids.has(row.itemId) && row.questionId === PROPOSAL_DECIDED && rule.decides?.(row.by)) decision = row;
      else if (row.value === "yes" && !row.questionId.startsWith("@") && asked.has(`${row.itemId}\u0000${row.questionId}`) && !row.cleared) choice.set(who, { option: KEEP_OPTION });
      else continue;
      // When the disagreement began: the moment two choices first stood side by side, or somebody said «no» to the
      // proposal, until they meet again.
      if (distinct() > 1 || anyNo()) since ??= row.at;
      else since = undefined;
    }
    // A choice of an option taken back by its author is no choice.
    for (const [who, one] of choice) if (one.option !== KEEP_OPTION && !live.has(one.option)) choice.delete(who);
    const choices = Object.fromEntries([...choice].map(([who, one]) => [who, one.option]));
    const named = (option: string) => [...choice].filter(([, one]) => one.option === option).map(([who]) => group.concat(views).find((view) => same(view.by, who))?.by ?? byTime.find((row) => same(row.by, who))?.by ?? who);
    const all = new Set(Object.values(choices));
    const decided = decision ? (decision.value === "yes" ? rootOf(decision.itemId) : KEEP_OPTION) : undefined;
    // A choice of a version since edited is to be looked at again: it does not settle the item until then.
    const current = (one: { option: string; version?: string }) => one.option === KEEP_OPTION || one.version === live.get(one.option)?.proposal.id;
    // Who says «no» to the version of an option in force: while somebody does, it is not agreed (27 October).
    const people = [...marked.keys()];
    const noByOf = (option: string) => {
      const head = live.get(option);
      return head ? people.filter((who) => saysNo(who, head.proposal.id)).map((who) => byTime.find((row) => same(row.by, who))?.by ?? who) : [];
    };
    const unanimous = choice.size >= Math.max(1, needed) && all.size === 1 && [...choice.values()].every(current) ? [...all][0] : undefined;
    const winner = decided ?? (unanimous && (unanimous === KEEP_OPTION || !noByOf(unanimous).length) ? unanimous : undefined);
    for (const [option, head] of live) {
      const view = out.get(head.proposal.id)!;
      const done = view.state === "applied" || view.state === "sent";
      const state = done ? view.state : winner === option ? "agreed" : winner ? "rejected" : "open";
      const stale = [...choice].filter(([, one]) => one.option === option && one.version !== head.proposal.id).map(([who]) => who);
      const noBy = noByOf(option);
      // Only a version checked with questions carries its marks: one with none (a change of a text) is chosen as before.
      const checks = asks && asks(head).length ? { marks: Object.fromEntries(people.map((who) => [who, Object.fromEntries(effective(who, head.proposal.id))] as const).filter(([, marks]) => Object.keys(marks).length)), noBy, origin: originOf(head.proposal.id) } : {};
      const next: ProposalView = { ...view, inFavour: named(option), against: named(KEEP_OPTION), state, choices, ...(stale.length ? { staleFor: stale } : {}), ...checks };
      delete next.disputedSince;
      delete next.decidedBy;
      if (!winner && since && (all.size > 1 || noBy.length)) next.disputedSince = since;
      if (decision && decided && !done) next.decidedBy = decision.by;
      out.set(head.proposal.id, next);
    }
    // An adjustment its author did not accept, left alone when that proposal was taken back, is not accepted: it
    // neither waits nor keeps the item open.
    for (const root of roots.map((view) => view.proposal.id)) {
      const head = headOf(root);
      if (!head || !standing(root) || options.includes(root) || adjusts.has(root)) continue;
      const next: ProposalView = { ...out.get(head.proposal.id)!, state: "rejected", adjustment: "declined", inFavour: [head.by], against: [], declinedBy: declinedBy(root, rootOf(head.proposal.suggests ?? root)) ?? "" };
      delete next.choices;
      delete next.disputedSince;
      out.set(head.proposal.id, next);
    }
    for (const [root, option] of adjusts) {
      for (const view of chainOf(root)) out.set(view.proposal.id, { ...out.get(view.proposal.id)!, adjusts: option });
      const head = headOf(root);
      const optionHead = live.get(option);
      if (!head || !optionHead) continue;
      const versions = new Set(chainOf(root).map((view) => view.proposal.id));
      const declined = declinedBy(root, option);
      // Written over another version than the option's now: it cannot be taken without taking out what changed since.
      const writtenOn = head.proposal.suggests ?? option;
      // Taken by a version its author has not taken back: one taken back took nothing, and the adjustment waits again.
      const adjustment: ProposalView["adjustment"] = chainOf(option).some((view) => view.state !== "withdrawn" && view.proposal.accepts && versions.has(view.proposal.accepts))
        ? "accepted"
        : declined
          ? "declined"
          : optionHead.proposal.id === writtenOn
            ? "pending"
            : sameWording(optionHead.proposal.after ?? "", head.proposal.after ?? "")
              ? "accepted"
              : "stale";
      const state: ProposalState = adjustment === "accepted" ? "replaced" : adjustment === "declined" || winner ? "rejected" : "open";
      const next: ProposalView = { ...out.get(head.proposal.id)!, adjusts: option, adjustment, state, inFavour: [head.by], against: [], ...(adjustment === "declined" ? { declinedBy: declined } : {}) };
      delete next.choices;
      delete next.staleFor;
      delete next.disputedSince;
      delete next.decidedBy;
      out.set(head.proposal.id, next);
    }
  }
  return views.map((view) => out.get(view.proposal.id)!);
}

/**
 * The versions of a proposal, oldest first, ending at `id` (21 October): a proposal the team goes on adjusting is
 * one proposal, each adjustment replacing the version before it (`replaces`), whoever makes it. Read as a chain, what
 * each version changed of the one before is what the conversation shows.
 */
export function versionsOf(views: ProposalView[], id: string): ProposalView[] {
  const byId = new Map(views.map((view) => [view.proposal.id, view]));
  const out: ProposalView[] = [];
  const seen = new Set<string>();
  for (let view = byId.get(id); view && !seen.has(view.proposal.id); view = view.proposal.replaces ? byId.get(view.proposal.replaces) : undefined) {
    seen.add(view.proposal.id);
    out.unshift(view);
  }
  return out;
}

/**
 * The answers that count for the checklist itself: a proposal its author took back no longer settles its «no», so
 * what was answered before it (or nothing) is what stands, and the help is to be checked again.
 */
export function withoutWithdrawn(answers: CheckAnswer[]): CheckAnswer[] {
  const gone = new Set(proposalsOf(answers, 1).filter((view) => view.state === "withdrawn").map((view) => view.proposal.id));
  return gone.size ? answers.filter((row) => !(row.outcome === "proposal" && row.proposal && gone.has(row.proposal.id))) : answers;
}

/** Whether nothing is left to settle: every proposal was carried out, taken back, answered with another or not accepted. */
export function proposalsSettled(views: ProposalView[]): boolean {
  return views.every((view) => view.state === "applied" || view.state === "sent" || view.state === "withdrawn" || view.state === "replaced" || view.state === "rejected");
}

// ---------------------------------------------------------------- a new version and the words it was written from

/** The words alone: the line ends and spaces a file is kept with (a note keeps its line ends as «\n») make no other version. */
const wording = (text: string) => text.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();

/**
 * A help as it reads, without the marks it is written with: a link as its words, bold without its asterisks, the
 * «\n» a note keeps its line ends as, a line end. For showing a version where a person reads it (a note with a
 * link took three lines more written out than read); two versions are told apart by what is written, not by this.
 */
export function readable(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\[\[[^\]]*\]\]/g, "")
    // «(ver: )»: what is left of a pointer to an article once its link is gone.
    .replace(/\s*\([^()\n]{0,20}:\s*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/[ \t]*\n\s*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Whether two versions say the same, whatever spaces and line ends they are kept with. */
export function sameWording(a: string, b: string): boolean {
  return wording(a) === wording(b);
}

/**
 * How a new version stands against the help as it is now. A new version is the whole of the words, written over
 * the ones it was proposed from; the lists of a task go over the same notes and each knows only its own proposals,
 * so two of them (or two people in one) can each propose a whole note starting from the same words, and the second
 * one applied took out what the first had put in.
 *
 * `fits`: the help still says what the proposal was written from, and can be written over. `done`: it already
 * says what is proposed (it was applied and saying so failed, or two people applied it at once), and there is
 * nothing to write. `changed`: it says something else, and writing the proposal would take that out. A proposal
 * that does not say what it was written from cannot be told, and fits.
 */
export type ProposalFit = "fits" | "done" | "changed";

export function proposalFit(proposal: Pick<ProposalPayload, "before" | "after">, current: string): ProposalFit {
  // Asked first: a proposal that only parts a paragraph in two says the same as what it was written from.
  if (proposal.before === undefined || sameWording(current, proposal.before)) return "fits";
  return proposal.after !== undefined && sameWording(current, proposal.after) ? "done" : "changed";
}

/**
 * The help a proposal would change: the row of the notes or questions, or the file of an article. Empty when it is
 * about no help of its own (a verse of a text, something that is missing).
 */
export function proposalHelp(proposal: ProposalPayload): string {
  const part = proposal.rowId || proposal.path;
  return part ? `${proposal.resource}:${part}` : "";
}

/** The words of that help a proposal would write over: of a row, one of its columns. */
export function proposalWords(proposal: ProposalPayload): string {
  const help = proposalHelp(proposal);
  return help && proposal.rowId ? `${help}:${proposal.field ?? "Note"}` : help;
}

/**
 * The proposals still to be resolved that are about a help another of them is about too, each with how many others
 * there are: the team reads them together before agreeing on one. One carried out, taken back or answered with
 * another version is no longer to be chosen among.
 */
export function sharedHelp(views: ProposalView[]): Map<string, number> {
  const live = views.filter((view) => (view.state === "open" || view.state === "agreed") && proposalHelp(view.proposal));
  const count = new Map<string, number>();
  for (const view of live) count.set(proposalHelp(view.proposal), (count.get(proposalHelp(view.proposal)) ?? 0) + 1);
  const others = new Map<string, number>();
  for (const view of live) {
    const rest = count.get(proposalHelp(view.proposal))! - 1;
    if (rest) others.set(view.proposal.id, rest);
  }
  return others;
}

/**
 * What each help says after the proposals already applied to it, by `proposalWords`. A trial writes nothing: there
 * this is how a help is taken to read, so the next proposal for it is met as it would be in the project.
 */
export function appliedWords(views: ProposalView[]): Record<string, string> {
  const words: Record<string, string> = {};
  for (const view of [...views].sort((a, b) => a.at.localeCompare(b.at))) {
    if (view.state === "applied" && view.proposal.after !== undefined && proposalWords(view.proposal)) words[proposalWords(view.proposal)] = view.proposal.after;
  }
  return words;
}

/**
 * Proposals in the order they are read in: by place, those about one help together (where the first of them
 * came), each help's in the order they were made. By time alone, two versions of a note stood apart with what was
 * proposed for the other notes of the verse between them.
 */
export function byPlaceAndHelp<T extends ProposalView>(views: T[]): T[] {
  const place = (where: string) => {
    const [chapter, verse] = where.split(":").map(Number);
    return (chapter || 0) * 1000 + (verse || 0);
  };
  const first = new Map<string, string>();
  const group = (view: T) => proposalHelp(view.proposal) || view.proposal.id;
  for (const view of views) if (!first.has(group(view)) || view.at < first.get(group(view))!) first.set(group(view), view.at);
  return [...views].sort((a, b) => place(a.proposal.where) - place(b.proposal.where) || first.get(group(a))!.localeCompare(first.get(group(b))!) || group(a).localeCompare(group(b)) || a.at.localeCompare(b.at));
}

const ASK_MAX = 600;
/** A new version of more words than this is told by what it changes. */
const ASK_WORDS = 12;

/**
 * What a new version changes, for one line: the words taken out and those put in, with a couple around them
 * («… más en él. Trabajo para …» → «… más en Jesús. Trabajo para …»). A short one is said whole.
 */
function changeInShort(before: string, after: string): string {
  if (!before || (after.match(/\S+/g) ?? []).length <= ASK_WORDS) return `→ «${after}»`;
  const pieces = diffExcerpt(wordDiff(before, after), 2);
  const side = (kind: "gone" | "new") => pieces.filter((piece) => piece.kind === "same" || piece.kind === kind).map((piece) => piece.text).join("").replace(/\s+/g, " ").trim();
  return `«${side("gone")}» → «${side("new")}»`;
}

/**
 * A proposal as it is asked of the team that maintains what it would change: why, and what would change. It names
 * the subtarea that team gets, which shows some 140 letters: it began with the question the proposal answered «no»
 * to and ended with the whole verse, so it was cut in the middle of the reason and never reached the change. The
 * whole of it is said in the conversation of that subtarea.
 */
export function proposalAsk(view: ProposalView, failed = ""): CorrectionAsk {
  const one = (text: string) => text.replace(/\s+/g, " ").trim();
  const after = one(view.proposal.after ?? "");
  // The reason is the person's to give or not: without one, what it answered «no» to is said in its place.
  const text = [one(view.reason) || failed.trim(), after ? changeInShort(one(view.proposal.before ?? ""), after) : ""].filter(Boolean).join(" ");
  return { about: view.proposal.resource, where: view.proposal.where, text: text.length > ASK_MAX ? `${text.slice(0, ASK_MAX - 1).trimEnd()}…` : text, by: view.by };
}

// ---------------------------------------------------------------- the old words beside the new

export type DiffPiece = { text: string; kind: "same" | "gone" | "new" };

/** More words than this on each side and the two versions are shown whole, one after the other. */
const DIFF_CELLS = 2_000_000;

/**
 * What changed between two versions, word by word, for reading them as one text: the words taken out, the words
 * put in, and those that stayed. Spaces go with the word before them.
 */
export function wordDiff(before: string, after: string): DiffPiece[] {
  const a = before.match(/\S+\s*/g) ?? [];
  const b = after.match(/\S+\s*/g) ?? [];
  const word = (piece: string) => piece.trim();
  let start = 0;
  while (start < a.length && start < b.length && word(a[start]!) === word(b[start]!)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && word(a[endA - 1]!) === word(b[endB - 1]!)) {
    endA--;
    endB--;
  }
  const out: DiffPiece[] = [];
  const push = (text: string, kind: DiffPiece["kind"]) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else if (text) out.push({ text, kind });
  };
  push(b.slice(0, start).join(""), "same");
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > DIFF_CELLS) {
    push(midA.join(""), "gone");
    push(midB.join(""), "new");
  } else {
    // The longest run of words the two middles share, kept in order.
    const rows = midA.length + 1;
    const cols = midB.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * cols + j] = word(midA[i]!) === word(midB[j]!) ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (word(midA[i]!) === word(midB[j]!)) {
        push(midB[j]!, "same");
        i++;
        j++;
      } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) push(midA[i++]!, "gone");
      else push(midB[j++]!, "new");
    }
    while (i < midA.length) push(midA[i++]!, "gone");
    while (j < midB.length) push(midB[j++]!, "new");
  }
  push(b.slice(endB).join(""), "same");
  // Words taken out at the end of a stretch keep the space that parted them from what follows; and what stays
  // before words taken out from the end, the space that parted it from them («… en Jesús.Si está…»).
  const spaced = (piece: DiffPiece, next: DiffPiece | undefined) => (piece.kind === "gone" && next?.kind === "new") || (piece.kind === "same" && next?.kind === "gone");
  return out.map((piece, index) => (spaced(piece, out[index + 1]) && !/\s$/.test(piece.text) ? { ...piece, text: `${piece.text} ` } : piece));
}

/**
 * The same, for reading in a line or two: the long stretches nothing changed in are cut to a few words at each
 * end, so what was taken out and put in is what is read. A note of nine lines with three words changed showed its
 * first two lines, where nothing had changed.
 */
export function diffExcerpt(pieces: DiffPiece[], keep = 6): DiffPiece[] {
  if (pieces.every((piece) => piece.kind === "same")) return pieces;
  return pieces.map((piece, index) => {
    if (piece.kind !== "same") return piece;
    const words = piece.text.match(/\S+\s*/g) ?? [];
    const first = index === 0;
    const last = index === pieces.length - 1;
    if (first) return words.length > keep ? { ...piece, text: `… ${words.slice(-keep).join("")}` } : piece;
    if (last) return words.length > keep ? { ...piece, text: `${words.slice(0, keep).join("").trimEnd()} …` } : piece;
    return words.length > keep * 2 + 1 ? { ...piece, text: `${words.slice(0, keep).join("").trimEnd()} … ${words.slice(-keep).join("")}` } : piece;
  });
}

// ---------------------------------------------------------------- a checklist opened to try

/**
 * Where the answers of a checklist opened to try are kept: in this tab, and nowhere else. A trial of one step is
 * followed by a trial of the agreement on what it proposed, so they have to outlast the screen; they never reach
 * the project.
 */
export function trialChecksKey(storeKey: string): string {
  return `gt-trial-checks:${scopeKey()}${storeKey}`;
}

export function loadTrialChecks(storeKey: string): CheckAnswer[] {
  try {
    const rows = JSON.parse(sessionStorage.getItem(trialChecksKey(storeKey)) ?? "[]") as unknown;
    return Array.isArray(rows) ? (rows as CheckAnswer[]) : [];
  } catch {
    return [];
  }
}

export function saveTrialChecks(storeKey: string, answers: CheckAnswer[]): void {
  try {
    sessionStorage.setItem(trialChecksKey(storeKey), JSON.stringify(answers));
  } catch {
    /* a private window: the trial lasts as long as its screen */
  }
}

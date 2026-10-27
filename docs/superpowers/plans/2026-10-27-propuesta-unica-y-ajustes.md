# Una sola propuesta por nota, con ajustes y comprobación por preguntas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a list decided together, each note has one proposal; others suggest adjustments its author accepts or not, and everybody checks the proposal with the step's per-item questions instead of choosing it with a touch.

**Architecture:** The reading stays in `proposalsOf(..., { consensus: true })` (`src/domain/checkProposal.ts`), whose `byChoice` learns two things from a new pure module `src/domain/singleProposal.ts`: which proposal views are adjustments of which option (and how each adjustment stands), and each person's marks on a proposal version. `checklist.ts` keeps adjustments out of the slots and gives the turn to whoever has an adjustment to answer. The screen (`NoteOptions.tsx`, a new `ProposalCheck.tsx`, `ChecklistView.tsx`) writes the new rows. `ProposalsView` reads proposals by majority (no `consensus`) and is left as it is: the spec's «donde se usa» does not reach it.

**Tech Stack:** React 18 + Vite + TypeScript; tests are `tsx` scripts with `node:assert/strict` (`npm run verify:check-proposal`, `npm run verify:checklist`).

**Spec:** `docs/superpowers/specs/2026-10-27-propuestas-con-preguntas-y-edicion-design.md`

## Global Constraints

- Nothing in `src/` names a step, question or tool of a process (`npm run verify:decoupling`).
- Interface text goes through `useT()` with keys in `src/i18n/locales/es.json` (source) and `pt.json`; `npm run verify:config` checks keys and `{markers}`. Edit the JSON files with a script that reads them first (never open for write and read in one expression).
- Comments and commits in English; commit title short, body says why; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not commit `scripts/mock-door43/server.mjs`, `scripts/tmp-*`, `respaldos/`, nor the line-end-only changes in `docs/MODELO.md`, `src/main.tsx`, `src/worker/client.ts`.
- Screens: one obvious thing to do, made for a finger at 375 px, 24–32 px between groups and 8–12 inside, every new text with its `html[data-text]` size rule.
- `DISPUTE_DAYS` stays 3. Row ids: marks use the real question id with `itemId` = the proposal version id; declining an adjustment is `questionId: "@ajuste"`, `value: "no"`.
- `SINGLE_PROPOSAL_FROM = "2026-10-28T00:00:00Z"`: set it to the publish date when this is deployed.

## Review Focus

1. A proposal written before `SINGLE_PROPOSAL_FROM` beside another (Ester's `asf7`) must stay an option, never turn into an adjustment — the team would lose a choice it already made.
2. A person with a «No» must not be asked again and again («Te toca») while the others answer nothing: their turn is the last word of the other side, as in a dispute today.
3. An adjustment written over a version the author since changed must never be accepted silently over the new text.
4. A step whose questions use `when`: a question that does not apply to the proposal's text must not be required to choose it.
5. The author withdrawing the proposal with adjustments pending: the first pending adjustment becomes the proposal, not lost.

Each has its test in Task 1 or Task 2.

---

### Task 1: Adjustments: one proposal per note (domain)

**Files:**
- Create: `src/domain/singleProposal.ts`
- Modify: `src/domain/checkProposal.ts` (`ProposalPayload`, `ProposalView`, `byChoice`)
- Modify: `src/domain/checklist.ts` (`slotsOf`: leave out views with `adjusts`)
- Test: `scripts/verify-check-proposal.mts`

**Interfaces:**
- Produces, in `checkProposal.ts`:
  - `ProposalPayload` gains `suggests?: string` (version id of the proposal it adjusts), `adjustedBy?: string`, `accepts?: string` (adjustment id).
  - `ProposalView` gains `adjusts?: string` (option id it adjusts) and `adjustment?: "pending" | "accepted" | "declined" | "stale"`, `declinedBy?: string`.
- Produces, in `singleProposal.ts`:
  - `export const SINGLE_PROPOSAL_FROM = "2026-10-28T00:00:00Z"`
  - `export const ADJUSTMENT_SAYS = "@ajuste"`
  - `export function adjustmentDeclined(adjustmentId: string, by: string, at: string, note?: string): CheckAnswer`
  - `export function optionsAndAdjustments(roots: ProposalView[], live: (id: string) => boolean): { options: string[]; adjusts: Map<string, string> }` — given the root views of one item (first versions, sorted by `at`) and whether each root's chain is still live, returns the option ids and, for each adjustment root id, the option id it adjusts.

Rules `optionsAndAdjustments` implements (in time order): a root with `suggests` adjusts the option whose chain holds that version, if that chain is live; otherwise it is treated like a new root. A root with no `suggests`, written at or after `SINGLE_PROPOSAL_FROM`, adjusts the first option when there is one; otherwise it becomes the option. A root written before `SINGLE_PROPOSAL_FROM` is always an option. Non-live roots are skipped.

How `byChoice` uses it, per item:
- Adjustment views get `adjusts`. They are not options, set nobody's choice, and are not counted in `live`, `choices` or `disputedSince`.
- Their `adjustment` is computed as follows:
  - `"accepted"` when some version of the option carries `accepts: <its id>`. Its `state` becomes `"replaced"`.
  - `"declined"` when the last `@ajuste` row on it is «no», written by the option's author or by someone `rule.decides`. Its `state` becomes `"rejected"`, with `declinedBy`.
  - `"stale"` when the option's head is not the version it names in `suggests` (an implicit one counts as written over the option's first version) and the head's `after` does not read like the adjustment's (`sameWording`). If it does read the same, it is `"accepted"`.
  - Otherwise `"pending"`.
  - In every case, an adjustment its author withdrew keeps `state: "withdrawn"`.
- Once the option is won (`agreed`, `applied`, `sent`) or the item settles for keeping it, pending and stale adjustments become `state: "rejected"`.
- A version that `accepts` an adjustment counts as its writer's own version, as today.

- [ ] **Step 1: Write the failing tests** in `scripts/verify-check-proposal.mts`.

  The tests use helpers like the ones already there: a payload `p(id, after, extra)` on `rowId: "n1"`, rows built with `proposalAnswer`, and `proposalsOf(rows, 3, () => true, { consensus: true, decides: (l) => l === "tito" })`.

  - `"una propuesta nueva sobre una nota que ya tiene propuesta se lee como ajuste a ella"`:
    - setup: ana's `pr-a` at 2026-10-28T10:00Z, then carla's `pr-b` (no `suggests`) at 10:10;
    - `pr-b`: `adjusts === "pr-a"`, `adjustment === "pending"`;
    - `pr-a.choices` has no `carla`; only `pr-a` is an option.
  - `"dos propuestas de antes de SINGLE_PROPOSAL_FROM siguen siendo dos opciones"`: the same rows dated 2026-10-21. Both have `adjusts === undefined` and `choices` has `carla: "pr-b"`.
  - `"un ajuste aceptado: la propuesta toma su texto, «ajustada por», y el ajuste ya no espera"`:
    - setup: ana's `pr-a`; bea's `aj-1` with `suggests: "pr-a"`, `after: "c"`; ana's `pr-a2` with `replaces: "pr-a"`, `accepts: "aj-1"`, `adjustedBy: "bea"`, `after: "c"`;
    - the head of option `pr-a` is `pr-a2`;
    - `aj-1`: `adjustment === "accepted"`, `state === "replaced"`.
  - `"un ajuste no aceptado por la autora queda a la vista y la propuesta no cambia"`:
    - setup: ana writes `adjustmentDeclined("aj-1", "ana", …)`;
    - `aj-1`: `adjustment === "declined"`, `declinedBy === "ana"`; the head is still `pr-a`.
    - `adjustmentDeclined` by bea, who is neither author nor decider, leaves it `"pending"`.
  - `"quien coordina puede aceptar o no un ajuste por la autora"`: tito's `adjustmentDeclined` gives `"declined"`; tito's accepting version gives `"accepted"`.
  - `"dos ajustes sobre la misma versión: al aceptar uno, el otro queda escrito sobre otra versión"`:
    - setup: `aj-1` and `aj-2` both suggest `pr-a`; ana accepts `aj-1`;
    - `aj-2.adjustment === "stale"`;
    - when `aj-2.after` equals `aj-1.after`, `aj-2.adjustment === "accepted"`.
  - `"la autora retira su propuesta: el primer ajuste pendiente pasa a ser la propuesta"`:
    - setup: `pr-a`, `aj-1` (10:10), `aj-2` (10:20), then ana's `proposalSaying("pr-a", "ana", …, false)`;
    - `aj-1.adjusts === undefined`; `aj-2.adjusts === "aj-1"`.
  - `"cuando la nota se acuerda, los ajustes que esperaban dejan de esperar"`: all three choose `pr-a` (old-style `proposalSaying` yes). `pr-a.state === "agreed"`, and the pending `aj-1.state === "rejected"`.
  - In `summarizeChecklist` with `agreement`, `"un ajuste no deja abierta la pregunta de la nota"`: with `pr-a` agreed and `aj-1` pending, the slot is `settled` and `open` is empty.

- [ ] **Step 2: Run them.** Run: `npm run verify:check-proposal`. Expected: FAIL. The first new test fails on an `adjusts` assertion, or on the missing export `adjustmentDeclined`.

- [ ] **Step 3: Implement** `singleProposal.ts` and the `byChoice` / `slotsOf` changes above. `byChoice` builds `roots` per item from the views whose `proposal.replaces` is absent (adjustment versions chain with `replaces` among themselves, as options do). The root of the chain decides.

- [ ] **Step 4: Run all proposal and checklist tests.** Run: `npm run verify:check-proposal && npm run verify:checklist`. Expected: both pass, with the earlier checks unchanged.

- [ ] **Step 5: Commit** `src/domain/singleProposal.ts src/domain/checkProposal.ts src/domain/checklist.ts scripts/verify-check-proposal.mts` with the title "Proposals: one per note, later ones read as adjustments to it".

### Task 2: Checking a proposal with the step's questions (domain)

**Files:**
- Modify: `src/domain/singleProposal.ts`, `src/domain/checkProposal.ts` (`ProposalRule`, `ProposalView`, `byChoice`), `src/domain/checklist.ts` (`slotsOf` voices, turn)
- Test: `scripts/verify-check-proposal.mts`, `scripts/verify-checklist.mts`

**Interfaces:**
- Consumes: Task 1's `adjusts` / `adjustment`.
- Produces:
  - `ProposalRule` gains `questionsOf?: (view: ProposalView) => string[]`: the per-item questions that apply to that version's text. Without it, choosing works as before Task 2: the author chooses by proposing, and `@acuerdo` / `@dejar` choose.
  - `export function proposalMark(versionId: string, questionId: string, by: string, at: string, value: "yes" | "no", note?: string): CheckAnswer` in `singleProposal.ts`.
  - `ProposalView` gains:
    - `marks?: Record<string, Record<string, "yes" | "no">>`: by person in lower case, the marks that count on the head version;
    - `noBy?: string[]`: who has a «No» on it;
    - `origin?: string[]`: the question ids its author's rows answer, without `@propuesta`.

Rules, with `questionsOf` given:
- **Required:** a person's marks on the head version are complete when every id of `questionsOf(head)` has «yes». For the author, the `origin` questions count as «yes» without a mark.
- **Carry-over:** a mark counts for a later version only when it was written by the option's author and every version after the one it names is the author's own, without `accepts`. Everybody else's marks are only for the version they name.
- **Choice:** what each person completed last. Completing all «yes» on the option's head chooses it. `@dejar` «sí», or «Sí» on a question of the note that the proposal answers, chooses to keep it, as today. `@acuerdo` «sí» on a version counts as «yes» on all its questions.
- **Version written at or after `SINGLE_PROPOSAL_FROM`:** it no longer chooses for its author by being written, unless the author's marks (carried over) and `origin` complete it. Older versions choose as today.
- **A «No»** on the head (the person's latest mark on some question is «no») takes that person's choice off the option. The option cannot win while `noBy` is not empty; `@decide` still settles it. `disputedSince` starts at the first moment there is a `noBy` or two different choices, and ends when neither holds.
- **In `checklist.ts`:**
  - the voices of a slot include `noBy` of its option;
  - a slot's `disputed` includes an option with `noBy`;
  - the turn is `"mine"` for the author of an option with a `"pending"` adjustment, and for the author of a `"stale"` adjustment.

- [ ] **Step 1: Write the failing tests.** Use `rule = { consensus: true, questionsOf: () => ["tpl", "tps", "acad"] }` and proposals dated 2026-10-28 or later.

  In `verify-check-proposal.mts`:
  - `"con «Sí» en todas las preguntas de la propuesta, la persona la elige; con una sin marcar, no"`: bea marks `tpl`, `tps` → no `bea` in `choices`; plus `acad` → `choices.bea === "pr-a"`.
  - `"quien propone: la pregunta donde nació cuenta como «Sí» suyo y las demás las tiene que marcar"`:
    - ana's proposal answers `tpl`: `choices.ana` is undefined;
    - after ana marks `tps` and `acad`: `choices.ana === "pr-a"`.
  - `"un «No» sin resolver impide que la propuesta se acuerde aunque tres la elijan"`:
    - ana, bea and carla complete «yes»; bea then marks `tps` «no»;
    - `state === "open"`, `noBy` deep-equals `["bea"]`, `disputedSince` is set;
    - bea marks `tps` «yes» again → `state === "agreed"`.
  - `"al cambiar el texto, las marcas de los demás quedan viejas; las de la autora en su propia edición, no"`:
    - ana edits `pr-a` → `pr-a2`;
    - bea's complete marks on `pr-a` make `staleFor` include `bea`, and `marks.bea` is undefined on `pr-a2`;
    - ana's own marks still count (`choices.ana === "pr-a"`, ana not in `staleFor`).
  - `"al aceptar un ajuste, se piden de nuevo las marcas de todos, salvo la pregunta donde nació"`: after ana accepts `aj-1`, `marks.ana` is undefined on the head and `choices.ana` is undefined.
  - `"un «de acuerdo» antiguo cuenta como «Sí» en todas las preguntas"`: `proposalSaying("pr-a", "bea", …, true)` gives `choices.bea === "pr-a"` with no marks.
  - `"sin questionsOf todo sigue como antes"`: the earlier consensus tests are unchanged (they already run without it).
  - `"una pregunta que no aplica al texto de la propuesta no se pide"`: `questionsOf: (v) => v.proposal.after?.includes("[[") ? ["tpl", "acad"] : ["tpl"]` — with an `after` without links, marking `tpl` alone chooses it.

  In `verify-checklist.mts`, `summarizeChecklist` with `agreement`:
  - `"quien dijo «No» a la propuesta espera a que el otro lado responda"`: bea has a «No» and was the last to write → `turn === "waiting"` for bea and `"mine"` for ana.
  - `"la autora tiene un ajuste por responder: le toca"`: a pending `aj-1` on ana's option → `turn === "mine"` for ana.

- [ ] **Step 2: Run them.** Run: `npm run verify:check-proposal && npm run verify:checklist`. Expected: FAIL on the first marks test (`choices.bea` undefined), or on the missing export `proposalMark`.

- [ ] **Step 3: Implement** the rules above in `byChoice` (marks are rows whose `itemId` is a version id of the item and whose `questionId` does not start with `@`) and in `checklist.ts`.

- [ ] **Step 4: Run the tests.** Run: `npm run verify:check-proposal && npm run verify:checklist && npx tsc --noEmit -p .`. Expected: all pass.

- [ ] **Step 5: Commit** with the title "Proposals: chosen by checking them with the step's questions".

### Task 3: Checking a proposal on screen

**Files:**
- Create: `src/components/ProposalCheck.tsx`
- Modify: `src/components/NoteOptions.tsx`, `src/components/ChecklistView.tsx`, `src/styles/components.css`, `src/i18n/locales/es.json`, `src/i18n/locales/pt.json`

**Interfaces:**
- Consumes: `proposalMark`, `ProposalView.marks / noBy / origin`, `rule.questionsOf`.
- Produces: `ProposalCheck` props:
  - `{ view: ProposalView; original: string; groups: { about: string; label: string; reference?: string; questions: { id: string; text: string }[] }[]; mine: Record<string, "yes" | "no">; me: string; saving?: boolean; onMark: (questionId: string, value: "yes" | "no", note?: string) => void; onAdjust: () => void; onDone: () => void }`.

What to build:
- **`questionsOf` in `ChecklistView`:** the per-item questions of the step (`per` absent or `"item"`) for which `asksOf(q, { text: view.proposal.after, linked: <the same test checkItems uses on item.supportRef, applied to the help> })` holds. Pass it in the `proposalsOf` rule only when `people` (decided together).
- **The groups:** the same groups and order `groupsOf(rowsHere)` gives for the note (TPL → TPS → Academia), keeping only the required questions. `reference` is the verse of that group's text (`data.texts[about].verses[item.verse]`), or nothing for the article.
- **`ProposalCheck` shows one group at a time:**
  - the group's text (`reference`), plain;
  - the proposal against the note with `TextChangeView` (what changes marked);
  - its questions, each with «Sí» / «No»;
  - «No» opens a required comment box and a link «Mejor sugerir un ajuste» (`onAdjust`);
  - after the last group, `onDone`.
  - The author does not see the origin questions.
- **In `NoteOptions`:**
  - the proposal's pick button and «Ver el cambio» are replaced by one filled button «Comprobar esta propuesta» while this person's marks are not complete;
  - under the name it says who checked it (complete) and, for each `noBy`, «{who} dice que no: «{note}»»;
  - «Dejarla como está» is still chosen with a touch.
- **Saving:** `ChecklistView` saves each mark with `save([proposalMark(head.proposal.id, qid, me, now, value, note)])`. A «No» comment is also saved as `itemSaying(item.id, me, now, note, option)`, so it is read in the option's conversation.

- [ ] **Step 1:** Add the i18n keys in Spanish and Portuguese, with a script that reads each JSON first:
  - `ck.optCheck` «Comprobar esta propuesta»;
  - `ck.optChecked` «La comprobaron: {who}»;
  - `ck.optSaysNo` «{who} dice que no: «{note}»»;
  - `ck.checkNoWhy` «¿Qué falla?»;
  - `ck.checkAdjustInstead` «Mejor sugerir un ajuste»;
  - `ck.checkNext` «Siguiente»;
  - `ck.checkDone` «Listo»;
  - `ck.checkOf` «Comprobando la propuesta de {who}».
- [ ] **Step 2:** Build `ProposalCheck` and wire it as above, with CSS rules (each text with its `html[data-text]` rule).
- [ ] **Step 3:** Run: `npx tsc --noEmit -p . && npm run verify:config && npm run verify:decoupling`. Expected: all pass.
- [ ] **Step 4:** Commit with the title "Checklist: a proposal is checked with the note's questions".

### Task 4: Adjustments on screen

**Files:**
- Modify: `src/components/NoteOptions.tsx`, `src/components/ChecklistView.tsx`, `src/styles/components.css`, i18n files

**Interfaces:**
- Consumes: Task 1 fields and `adjustmentDeclined`.

What to build:
- **Opening the editor (`adjustProposal`):**
  - author: a version with `replaces`, as today;
  - anybody else: an adjustment, with `suggests: head.proposal.id` and no `replaces`;
  - «Escribirlo de nuevo» on a stale adjustment: `suggests` = the head now, `replaces` = the old adjustment.
  - The editor starts from `head.proposal.after`. `before` stays the note's text.
  - The lead (`pr.adjusting`) says whose proposal it adjusts.
- **Accepting (`acceptAdjustment(adj)`)**, by the author, or by a decider once `disputeStalled`-like `DISPUTE_DAYS` have passed since the adjustment:
  - writes the option's question rows (as `adjustProposal` gathers them) with a payload copied from the adjustment;
  - the payload gets a new id, `replaces: head.proposal.id`, `accepts: adj.proposal.id`, `adjustedBy: adj.by`, and `before: head.proposal.before`.
- **Declining:** `adjustmentDeclined(adj.proposal.id, me, now, note)`.
- **Coordinator deciding for an adjustment:** writes the accepting version, then `proposalDecided(<that version id>, me, now, true)`.
- **In `NoteOptions`,** under the proposal, each adjustment that is not accepted shows:
  - «{who} sugiere este ajuste», its reason, and `TextChangeView` from the head's `after` to the adjustment's `after`;
  - pending: «Aceptar» / «No aceptar» for the author; «Retirar» for its writer;
  - stale: «Se escribió sobre otra versión de la propuesta», plus «Escribirlo de nuevo» for its writer;
  - declined: «{who} no lo aceptó».
- **The proposal's name:** «Cambio de {who}, ajustado por {names}» when its versions carry `adjustedBy`.
- **Buttons:**
  - `ck-opts__new` («Proponer otra opción») is no longer shown;
  - the option's «Editar» reads «Cambiar mi propuesta» for its author and «Sugerir un ajuste» for others.
- **Bar text:** when the author has a pending adjustment, the bar news says «{who} sugiere un ajuste a su propuesta».

- [ ] **Step 1:** Add the i18n keys:
  - `ck.adjSuggests` «{who} sugiere este ajuste»;
  - `ck.adjAccept` «Aceptar»;
  - `ck.adjDecline` «No aceptar»;
  - `ck.adjDeclined` «{who} no lo aceptó»;
  - `ck.adjStale` «Se escribió sobre otra versión de la propuesta»;
  - `ck.adjRewrite` «Escribirlo de nuevo»;
  - `ck.adjSuggest` «Sugerir un ajuste»;
  - `ck.adjEditMine` «Cambiar mi propuesta»;
  - `ck.optByAdjusted` «Cambio de {who}, ajustado por {names}»;
  - `ck.barAdjustment` «{who} sugiere un ajuste a su propuesta»;
  - `pr.adjustingOf` «Ajuste a la propuesta de {who}».
- [ ] **Step 2:** Implement the above.
- [ ] **Step 3:** Run: `npx tsc --noEmit -p . && npm run verify:config && npm run verify:decoupling && npm run verify:check-proposal && npm run verify:checklist`. Expected: all pass.
- [ ] **Step 4:** Commit with the title "Checklist: adjustments to a proposal, accepted or not by its author".

### Task 5: Check it in the browser

- [ ] **Step 1:** Run the mock with a book seeded (`MOCK_PM_ORG=es-419_gl MOCK_SEED_BOOK=EST`) and the app in the browser with ana, bea and carla (`?mockUser=`). Do this at 375 px and on desktop:
  - ana proposes, and checks her proposal;
  - bea checks it with a «No» and a comment;
  - carla suggests an adjustment, and ana accepts it;
  - bea's and ana's marks are asked again;
  - a second adjustment, written before the acceptance, shows «Escribirlo de nuevo»;
  - one adjustment is not accepted.
- [ ] **Step 2:** Pass the checklist in `docs/FILOSOFIA_DE_DISENO.md`: measure gaps and targets of 44 px or more, with no horizontal scroll at 375 px. Fix what fails, then run `npx tsc --noEmit -p .` again and commit «Checklist: … (layout)» if there were changes.

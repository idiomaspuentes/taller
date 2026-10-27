# Armonización colaborativa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each step of a note in the harmonization checklist says whether the person opens the note or collaborates on what someone said, asks them as a person (one filled button), shows a proposal as the note being reviewed, and keeps one conversation per note.

**Architecture:**
- **Two pure domain functions:**
  - `noteSituation` (`src/domain/noteSituation.ts`) decides the situation of a step for the person looking, and gives the rows one «Estoy de acuerdo» writes.
  - `noteTimeline` (`src/domain/noteTimeline.ts`) builds the note's conversation from the same rows.
- **`ChecklistView` uses them** in its decision-together mode (`people > 0`): a situation line, the title, the help card (the proposal when there is one), the decision area and the conversation.
- **What stays as today:** the old multi-option notes (`NoteOptions`), verse stops, single-person lists and the coordinator's decision.

**Tech Stack:** React 18 + Vite + TypeScript; tests are `tsx` scripts with `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-10-27-armonizacion-colaborativa-design.md` (and, for the rules underneath, `docs/superpowers/specs/2026-10-27-propuestas-con-preguntas-y-edicion-design.md`).

## Global Constraints

- Branch `propuesta-unica`, in the main checkout. Work there; nothing is pushed or deployed.
- Comments and commits are in English. Commits have a short title and a why-body, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `scripts/mock-door43/server.mjs`, `scripts/tmp-*`, `respaldos/`, or the line-end-only changes in `docs/MODELO.md`, `src/main.tsx`, `src/worker/client.ts`.
- Interface text goes through `useT()`. Add keys to `es.json` and `pt.json` with the scratchpad script `add_keys.py`, which inserts lines after an anchor. Never rewrite either file whole: `es.json` has a repeated key.
- `npm run verify:config` and `npm run verify:decoupling` must pass. Nothing in `src/` names a step or a question of a process.
- Screens follow `docs/FILOSOFIA_DE_DISENO.md`:
  - one filled button;
  - targets of 44 px or more;
  - 24–32 px between groups and 8–12 px inside them;
  - every new text gets its `html[data-text]` rule;
  - nothing new fixed on the phone.
- The app speaks to its user with «tú». Faces use `PersonPhoto` / `door43Person`, as the chapter list does.
- `SINGLE_PROPOSAL_FROM` stays `"2026-10-28T00:00:00Z"` in commits. To try today's writes in the browser, move it in the working copy only and revert it before committing.

## Decided here (the spec leaves them open)

- **Who is missing.** The list does not load the names of who took the subtask, so «Falta» says how many, not who:
  - «Falta: tú y {n} más» when others are missing;
  - «Falta: tú» when only this person is.

  `{n}` is `people` minus those who agreed minus this person. «Esperando a otros» stays the chip of the chapter list; the faces next to it already say who spoke. Ask Abel whether he wants the names loaded.
- **Old single proposals.** An option begun before `SINGLE_PROPOSAL_FROM` is also shown in the proposal situation. There, «Estoy de acuerdo» writes two kinds of rows:
  - the proposal's marks;
  - «Sí» on the note for the step's questions the proposal does not answer. Those questions are not attached to an old proposal (see `wholeAt` in `checklist.ts`), and without these rows they would stay open.
- **A proposal with no questions** (a change of the TPL text): «Estoy de acuerdo» writes `proposalSaying(id, me, at, true)`, as before.

## Review Focus

1. **A proposal arriving while the person is on the screen** (someone writes from another phone): the screen must switch to the proposal situation on the next reading. It must not keep offering «Sí, todo se cumple» over the old text and save it.
2. **«Estoy de acuerdo» on the last step of a note that this agreement settles:** the person must be told «Quedó acordada» and taken to the next note, not left on a closed note.
3. **A note with a proposal and an article that is not translated yet** (Academia step, `articleInSource`): the article-waiting question must still come first, as today.
4. **A conversation of more than ten messages:** the decision buttons must stay right under the last two messages, at the same height on the screen.
5. **A message written by the person** must not turn the note into «Te preguntan» for that same person.

Each of these has its test or browser check in the owning task.

---

### Task 1: The situation of a step, and what agreeing writes

**Files:**
- Create: `src/domain/noteSituation.ts`
- Modify: `src/domain/checkProposal.ts` (`itemSaying` gains `step`), `src/domain/checklist.ts` (`CheckAnswer.step?: string`)
- Test: `scripts/verify-note-situation.mts` (new), and `package.json` script `"verify:note-situation": "tsx --tsconfig tsconfig.scripts.json scripts/verify-note-situation.mts"`

**Interfaces:**
- Produces:

```ts
export type StepRow = { answerItemId: string; questionId: string };
export type NoteSituation =
  | { kind: "first" }
  | { kind: "confirm"; by: string[] }                       // others with «Sí» on every question of the step, on the note
  | { kind: "proposal"; head: ProposalView; author: string; since: string; agreed: string[]; doubts: string[] }
  | { kind: "ownProposal"; head: ProposalView; since: string; agreed: string[]; doubts: string[] }
  | { kind: "asked"; by: string; at: string; text: string }
  | { kind: "options" };                                     // two or more live options: NoteOptions as today
export function noteSituation(p: { me: string; itemId: string; stepRows: StepRow[]; answers: CheckAnswer[]; options: ProposalView[] }): NoteSituation;
export function agreementRows(p: { me: string; at: string; situation: NoteSituation; stepRows: StepRow[]; proposalQuestions: string[] }): CheckAnswer[];
export function itemSaying(itemId: string, by: string, at: string, text: string, about?: string, step?: string): CheckAnswer; // in checkProposal.ts
```

**What the inputs are:**
- `options` is what `ChecklistView` already calls the note's heads (`optionsHere.heads`): live option heads of the note, without adjustments.
- `since` is the `at` of the option's first version.
- `agreed` is `head.inFavour`.
- `doubts` is `head.noBy ?? []`.

**The order the situation is decided in** (the first one that holds wins):
1. **`asked`:** the last `@conversacion` row of `itemId` is by someone else and later than this person's last row. A row counts as this person's when it has `itemId` (any question), a version id of `options`, or a proposal whose `rowId` is `itemId`.
2. **`options`:** two or more options.
3. **`proposal` or `ownProposal`:** exactly one option. It is `ownProposal` when the first version's author is `me`.
4. **`confirm`:** someone other than `me` has, as their last answer, «yes» on every `stepRows` slot (cleared answers do not count).
5. **`first`:** none of the above.

**What `agreementRows` writes:**
- **`first` / `confirm`:** «yes» on each `stepRows` slot, without `textHash` (the caller stamps it).
- **`proposal` / `ownProposal`:**
  - `proposalMark(head.proposal.id, q, me, at, "yes")` for each step question in `proposalQuestions`;
  - for `ownProposal`, minus the questions in `head.origin`;
  - if `since < SINGLE_PROPOSAL_FROM`, also «yes» on the note for the step slots whose question is not in `head.origin`;
  - if `proposalQuestions` is empty, only `proposalSaying(head.proposal.id, me, at, true)`.
- **`asked` / `options`:** nothing (`[]`).

- [ ] **Step 1: Write the failing tests** in `scripts/verify-note-situation.mts`. Use the style of `verify-check-proposal.mts`: ana, bea and carla; item `n1`; questions `tpl1`, `tpl2` (step TPL) and `tps1` (step TPS); dates on 2026-10-28.
  - `"nadie dijo nada: la abres tú"` → `first`.
  - `"Ana dijo que sí a todo el TPL: Bea confirma en el TPL y abre el TPS"` → `confirm` with `by` deep-equal `["ana"]` for the TPL rows, and `first` for `[tps1]`.
  - `"Ana dijo que sí a una sola pregunta del TPL: Bea todavía la abre"` → `first`.
  - `"una propuesta de Ana: Bea la revisa en todos los pasos y Ana la ve como suya"` → `proposal` for bea, with `author === "ana"`, in both steps; `ownProposal` for ana.
  - `"un mensaje de Ana sin respuesta: a Bea le preguntan"` → `asked` with `text`; after a bea `itemSaying` it is no longer `asked`; and for ana herself it is never `asked` (Review Focus 5).
  - `"dos propuestas de antes son opciones, como hoy"` → `options`.
  - `"estar de acuerdo con Ana escribe sí en cada punto del paso"` → `agreementRows` for `confirm` gives two rows, `{ itemId: "n1", questionId: "tpl1" | "tpl2", value: "yes", by: "bea" }`.
  - `"estar de acuerdo con la propuesta marca la versión; la autora no marca la pregunta donde nació"`:
    - for `proposal` it gives `proposalMark` rows on the head id for `tpl1`, `tpl2`;
    - for `ownProposal`, with `origin ["tpl1"]`, only `tpl2`.
  - `"con una propuesta de antes, estar de acuerdo dice sí también a lo que la propuesta no responde"`:
    - `since` is on 2026-10-21 and `origin` is `["tpl1"]`;
    - the result has the marks plus a «yes» on `n1/tpl2`.
  - `"una propuesta sin preguntas se apoya como antes"` → `proposalQuestions: []` gives exactly one `@acuerdo` «yes» row.
- [ ] **Step 2: Run them.** Run: `npm run verify:note-situation`. Expected: FAIL with a missing module error for `../src/domain/noteSituation`.
- [ ] **Step 3: Implement** `noteSituation`, `agreementRows`, the `step` parameter of `itemSaying` and the optional field `step` on `CheckAnswer`.
- [ ] **Step 4: Run the tests.** Run: `npm run verify:note-situation && npm run verify:check-proposal && npm run verify:checklist && npx tsc --noEmit -p .`. Expected: all pass.
- [ ] **Step 5: Commit** «Checklist: the situation of a step for whoever looks at it».

### Task 2: The conversation of a note

**Files:**
- Create: `src/domain/noteTimeline.ts`
- Test: `scripts/verify-note-timeline.mts` (new), and `package.json` script `"verify:note-timeline"`.

**Interfaces:**
- Consumes: `itemSaying(..., step)` and `CheckAnswer.step` from Task 1.
- Produces:

```ts
export type TimelineEntry =
  | { kind: "message"; by: string; at: string; text: string; step?: string }
  | { kind: "reviewed"; by: string; at: string; step: string; first: boolean }   // «Sí» on every question of a step, on the note
  | { kind: "agreed"; by: string; at: string; step: string }                    // the same on the proposal (marks)
  | { kind: "saidNo"; by: string; at: string; step?: string }
  | { kind: "proposed" | "changed" | "suggested" | "accepted" | "declined"; by: string; at: string; view: ProposalView }
  | { kind: "decided"; by: string; at: string; apply: boolean };
export type NoteStep = { about: string; rows: StepRow[] };
export function noteTimeline(p: { me: string; itemId: string; answers: CheckAnswer[]; proposals: ProposalView[]; steps: NoteStep[] }): { entries: TimelineEntry[]; newFrom: number };
```

**Which entry each row makes:**
- `proposals` here are all the views of the note: options, their versions and their adjustments.
- **`proposed`:** the first version of an option.
- **`changed`:** a later version by its author, without `accepts`.
- **`accepted`:** a version with `accepts`. Its `by` is the version's writer.
- **`suggested`:** the first version of an adjustment.
- **`declined`:** an `@ajuste` «no» row. Its `view` is the adjustment.
- **`reviewed`:** at the time of the person's last «yes» that completed the step. `first` is true if nobody else completed that step on the note before.
- **`agreed`:** the same, for marks on the option's versions.
- **`saidNo`:** the person's mark «no» on a proposal.
- **`decided`:** an `@decide` row.
- **Order:** entries are sorted by `at`.
- **`newFrom`:** the index of the first entry by someone else after this person's last entry. It is `-1` when nothing came after, or when this person has no entry.

- [ ] **Step 1: Write the failing tests** in `scripts/verify-note-timeline.mts`. Use the same people and steps as Task 1.
  - `"los mensajes y lo que cada quien hizo, en el orden en que pasó"`: ana proposes, bea writes, ana accepts an adjustment by bea, and carla agrees on TPL. The kinds are in order: `["proposed", "message", "suggested", "accepted", "agreed"]`.
  - `"cada mensaje lleva su paso, y uno antiguo ninguno"`: `itemSaying(..., "tpl")` has `step === "tpl"`; a row without `step` has `step === undefined`.
  - `"la primera revisión de un paso dice revisó; las siguientes, está de acuerdo"`: ana's «yes» on `tpl1` and `tpl2` gives `reviewed` with `first === true`; bea's then gives `first === false`.
  - `"lo nuevo para ti empieza después de lo último que hiciste"`: bea writes, then ana writes twice. For bea, `newFrom` is the index of ana's first message. For ana, it is `-1`.
  - `"quien no ha hecho nada no tiene marca de nuevo"`: carla gets `newFrom === -1`.
- [ ] **Step 2: Run them.** Run: `npm run verify:note-timeline`. Expected: FAIL with a missing module error.
- [ ] **Step 3: Implement** `noteTimeline`.
- [ ] **Step 4: Run the tests.** Run: `npm run verify:note-timeline && npx tsc --noEmit -p .`. Expected: pass.
- [ ] **Step 5: Commit** «Checklist: one conversation per note, with what each person did in it».

### Task 3: What the step says and shows

**Files:**
- Create: `src/components/SituationLine.tsx`, `src/components/ProposalCard.tsx`, `src/components/AdjustmentList.tsx` (the adjustments block moved out of `NoteOptions.tsx`, which then uses it)
- Modify: `src/components/ChecklistView.tsx` (heading, help card, the ✓ line under each question), `src/styles/components.css`, i18n

**Interfaces:**
- Consumes: `noteSituation` from Task 1, and the existing `TextChangeView` and `PersonPhoto`/`door43Person`.
- Produces: `situation` (a `useMemo` in `ChecklistView` over `rowsShown`, `answers`, `optionsHere?.heads`), used by Tasks 4 and 5.

**Props of the new components:**
- `SituationLine`: `{ situation: NoteSituation; people: number; me: string; nameOf: (login: string) => string }`
- `ProposalCard`: `{ head: ProposalView; original: string; authorLabel: string; adjustedBy: string[]; reason: string; place: string }`. It shows the change with `TextChangeView` and has a «Ver como está» / «Ver con el cambio» toggle. `place` is «Ester 2:1 · e4lp».
- `AdjustmentList`: `{ adjustments: ProposalView[]; head: ProposalView; me: string; authorIsMe: boolean; closed: boolean; canAnswerFor: (a: ProposalView) => boolean; canDecide: boolean; saving?: boolean; onAccept; onDecline; onRewrite; onWithdraw }`, with the same callbacks as `NoteOptions` has today.

**What to build**, only when `people > 0`, not at a verse stop, and the situation is not `options`:
- **`SituationLine`** goes right under the step pills, in place of the `ck-said` counter line under each question and of the «Opiniones de acuerdo…» status. The texts are the spec's table, with the «Falta» rule from «Decided here».
- **The title** (`ck-heading`) per situation:
  - `confirm`: «¿Estás de acuerdo con {who}?»
  - `proposal`: «¿La propuesta de {who} cumple frente al {text}?» (in the Academia step: «…en el artículo?»)
  - `ownProposal`: «Tu propuesta frente al {text}»
  - `asked`: no title.
  - `first`: as today.
- **The help card** shows `ProposalCard` in `proposal` and `ownProposal`; `AdjustmentList` goes right under it. The note's own text stays one tap away inside the card.
- **Under each question**, in `confirm` and `proposal`, the other people's answer goes in readable size: «✓ Ana: sí» or «✗ Bea: no».
- **`NoteOptions`** stays only for `options`. The `ProposalCheck` walk is no longer opened from here (Task 4 replaces it).

**Keys:**
- `ck.sitFirst` «Eres la primera persona en revisar esta nota. Tu revisión abre la conversación.»
- `ck.sitConfirm` «{who} ya revisó esta nota.»
- `ck.sitProposal` «{who} propone un cambio.»
- `ck.sitAgreed` «{who} están de acuerdo con la propuesta.» / `ck.sitAgreedOne` «{who} está de acuerdo con la propuesta.»
- `ck.sitDoubt` «{who} tiene una duda.»
- `ck.sitOwn` «Tu propuesta.»
- `ck.sitAsked` «{who} dejó una pregunta sobre esta nota.»
- `ck.sitAnswered` «{who} te respondió.»
- `ck.sitMissing` «Falta: tú y {n} más.» / `ck.sitMissingYou` «Falta: tú.»
- `ck.headConfirm` «¿Estás de acuerdo con {who}?»
- `ck.headProposal` «¿La propuesta de {who} cumple frente al {text}?»
- `ck.headProposalArticle` «¿La propuesta de {who} cumple con el artículo?»
- `ck.headOwn` «Tu propuesta frente al {text}»
- `ck.cardProposal` «La nota con la propuesta de {who}» / `ck.cardProposalAdjusted` «La nota con la propuesta de {who}, ajustada por {names}»
- `ck.cardAsIs` «Ver como está» / `ck.cardWithChange` «Ver con el cambio»
- `ck.saidBy` «{who}: sí» / `ck.saidNoBy` «{who}: no»

The Portuguese is translated in the same step. `sitAsked` is chosen when this person has not written on the note before, and `sitAnswered` when they have.

- [ ] **Step 1:** Add the keys (es and pt) with `add_keys.py`.
- [ ] **Step 2:** Build the three components, move the adjustments block of `NoteOptions` into `AdjustmentList`, and wire everything into `ChecklistView` as above.
- [ ] **Step 3:** Run: `npx tsc --noEmit -p . && npm run verify:config && npm run verify:decoupling && npm run verify:checklist`. Expected: pass.
- [ ] **Step 4:** In the browser (mock; ana, bea and carla; 375 px), open one note in each situation. The line, the title and the card must match the spec's tables. Then commit «Checklist: each step says whether you open the note or collaborate on it».

### Task 4: Answering

**Files:**
- Create: `src/components/NoteAnswer.tsx`
- Modify: `src/components/ChecklistView.tsx` (the `ck-go` area and the checks list), CSS, i18n

**Interfaces:**
- Consumes: `agreementRows` from Task 1, `situation` from Task 3, and the existing `save`, `stamp`, `setMark`, `proposeFailing`, `adjustProposal`, `withdrawWhole`, `itemSaying`.
- Produces:
  - `NoteAnswer` props: `{ situation: NoteSituation; doubting: boolean; failing: string[]; saving?: boolean; onAgree: () => void; onDoubt: () => void; onPropose: () => void; onAdjust: () => void; onComment: () => void; onReply: () => void; onChangeMine: () => void; onWithdrawMine: () => void }`.

**The button rows:**

| Situation | Filled | Then |
|---|---|---|
| `first` | «Sí, todo se cumple» (the `allGood` of today) | «Proponer un cambio», «Comentar» |
| `confirm` | «Estoy de acuerdo» | «No del todo…» |
| `proposal` | «Estoy de acuerdo con la propuesta» | «No del todo…», «Sugerir un ajuste», «Comentar» |
| `ownProposal` | «Responder» when `doubts` is not empty, otherwise nothing is filled | «Cambiar mi propuesta», «Retirar» |
| `asked` | «Responder a {who}», which focuses the box of the conversation (Task 5) | «También puedes revisar los puntos», which shows the step's questions with their buttons |

**What each button does:**
- **«Estoy de acuerdo» (and «…con la propuesta»):**
  - saves `agreementRows(...)`; rows on the note are stamped with `stamp()` so they carry `textHash`;
  - then goes to the next step of the note, as `allGood` does;
  - if after the save the note's tally turns `ok`, says once «Quedó acordada: {names}.» and goes to the next note (`goOn`) (Review Focus 2).
- **«No del todo…»** sets `doubting`. That shows «Sí / No» on each question (the existing `setMark`), with the other's answer beside it. A «No» then asks for one of two things:
  - in `confirm`: «Proponer el cambio» (`proposeFailing`) or «Decir qué falla» (the existing comment form, which now saves `itemSaying(..., step)` with the step's `about`);
  - in `proposal`: «Sugerir un ajuste» (`adjustProposal(head, failing slots)`) or «Decir qué falla». This saves `proposalMark(head, q, me, at, "no", text)` and the message with its step.

**What stays the old tree:** the article-waiting question (`articleInSource`, Review Focus 3), `decideHere`, `stepDone`, verse stops, single-person lists and `options`.

**Keys:**
- `ck.ansAllGood` «Sí, todo se cumple»
- `ck.ansAgree` «Estoy de acuerdo»
- `ck.ansAgreeProposal` «Estoy de acuerdo con la propuesta»
- `ck.ansDoubt` «No del todo…»
- `ck.ansSayWhat` «Decir qué falla»
- `ck.ansReply` «Responder» / `ck.ansReplyTo` «Responder a {who}»
- `ck.ansCheckToo` «También puedes revisar los puntos»
- `ck.ansSettled` «Quedó acordada: {names}.»

`ck.adjSuggest`, `ck.adjEditMine` and `ck.withdraw` already exist.

- [ ] **Step 1:** Add the keys (es and pt).
- [ ] **Step 2:** Build `NoteAnswer` and wire it as above. Remove the `ProposalCheck` import from `NoteOptions` only if `options` no longer needs it. Old option lists keep their touch, so it probably stays.
- [ ] **Step 3:** Run: `npx tsc --noEmit -p . && npm run verify:config && npm run verify:decoupling && npm run verify:note-situation && npm run verify:checklist && npm run verify:check-proposal`. Expected: pass.
- [ ] **Step 4:** In the browser (mock, cutoff moved locally), do these and check that the tally changes as expected:
  - bea agrees with ana's review;
  - carla agrees with ana's proposal in all three steps (the note is agreed and says so);
  - bea says «No del todo…» → «Decir qué falla».

  For Review Focus 1, while bea has the note open, write a proposal for it as ana from a second tab. After the next reading, bea's screen shows the proposal. Then commit «Checklist: answering is agreeing with someone, or saying what fails».

### Task 5: The conversation on screen

**Files:**
- Create: `src/components/NoteThread.tsx`
- Modify: `src/components/ChecklistView.tsx` (in place of `talkView`'s `NoteConversation` when `people > 0` and the situation is not `options`), CSS, i18n

**Interfaces:**
- Consumes: `noteTimeline` from Task 2, and `itemSaying(..., step)`.
- Produces: `NoteThread` props: `{ entries: TimelineEntry[]; newFrom: number; me: string; nameOf: (login: string) => string; stepLabel: (about: string) => string; step: string; saving?: boolean; onSay: (text: string, step: string) => Promise<void> | void; onShow: (view: ProposalView) => void }`.

**What to build:**
- **In the note:**
  - the title «Conversación de la nota · {n} mensajes»;
  - the last two `message` entries;
  - a box «Escribe al equipo…» with a send button (44 px);
  - «Ver toda la conversación ({n})».

  It goes between the help card (and its adjustments) and `NoteAnswer`. With no entries at all, only the box, labeled «Escribe al equipo…».
- **The whole conversation:** a sheet (the `Dialog` with `fix-sheet help-sheet`, as the article sheet uses), with every entry.
  - Messages show the face, the name and the step tag.
  - Other entries are one quiet line each («Ana propuso un cambio · ver», «Bea está de acuerdo · TPS», …). «ver» calls `onShow`, which opens the change in `TextChangeView`.
  - A «nuevo para ti» rule goes before `entries[newFrom]`, and the sheet opens scrolled to it.
  - The box sits at the bottom of the sheet.
  - `HelpMessages` of other teams stays folded at its end.
- **Sending:** a message is saved with `itemSaying(item.id, me, now, text, undefined, step)`, where `step` is the `about` of the group in view. This person stays on the note (no `goOn`).
- **Desktop:** at 1280 px or more, the thread may be a column beside the note. That is only if it fits the existing desktop grid. Otherwise it keeps the same place.

**Keys:**
- `ck.threadTitle` «Conversación de la nota» / `ck.threadCount` «{n} mensajes» / `ck.threadCountOne` «1 mensaje»
- `ck.threadAll` «Ver toda la conversación ({n})»
- `ck.threadWrite` «Escribe al equipo…» / `ck.threadSend` «Enviar»
- `ck.threadNew` «nuevo para ti»
- `ck.tlProposed` «{who} propuso un cambio»
- `ck.tlChanged` «{who} cambió su propuesta»
- `ck.tlSuggested` «{who} sugirió un ajuste»
- `ck.tlAccepted` «{who} aceptó el ajuste de {other}»
- `ck.tlDeclined` «{who} no aceptó el ajuste de {other}»
- `ck.tlReviewed` «{who} revisó: todo se cumple»
- `ck.tlAgreed` «{who} está de acuerdo»
- `ck.tlSaidNo` «{who} dijo que no»
- `ck.tlDecided` «{who} decidió»
- `ck.tlSee` «ver»

Each `ck.tl*` line in the first person uses its own key: `ck.tlProposedMine` «Propusiste un cambio», and so on for each.

- [ ] **Step 1:** Add the keys (es and pt).
- [ ] **Step 2:** Build `NoteThread` and wire it.
- [ ] **Step 3:** Run: `npx tsc --noEmit -p . && npm run verify:config && npm run verify:decoupling && npm run verify:note-timeline`. Expected: pass.
- [ ] **Step 4:** In the browser, write twelve messages between ana and bea on one note (Review Focus 4). At 375 px, the buttons of `NoteAnswer` keep the same distance from the top of the screen as with two messages; measure the difference with `getBoundingClientRect`. The sheet must open at «nuevo para ti». Then commit «Checklist: the conversation of a note, its last words in view and the rest in a sheet».

### Task 6: The chapter list and «Mis tareas»

**Files:**
- Modify: `src/domain/chapterRoster.ts` (`RosterRow.reason?: string`; `rosterOf` takes `reasons?: Map<string, string>`), `src/components/ChapterHelpsList.tsx` (shows `reason` under the chip when status is `mine`), `src/components/ChecklistView.tsx` (builds `reasons` with `noteSituation` per item that is this person's turn), i18n
- Test: `scripts/verify-chapter-roster.mts`

**Which words change:**
- `ck.rowReady`: «Lista» → «Acordada»; `ck.listReady`: «Listas» → «Acordadas».
- `ck.rowUnread`: «Sin revisar» → «Nadie la revisó aún». `ck.listUnread` / `ck.listFilterUnread` keep «Sin revisar», because they are short for the filter.
- Any «Mis tareas» key that says «Listas» or «Sin revisar» of these notes: find them with `grep` on `es.json`, and change them the same way.

**The reason line under «Te toca»:**
- `ck.whyProposal` «{who} propone un cambio»
- `ck.whyAnswered` «{who} te respondió»
- `ck.whyAsked` «{who} dejó una pregunta»
- `ck.whyReviewed` «{who} ya la revisó»
- `ck.whyAdjustment` «{who} sugiere un ajuste a tu propuesta»

**Where the reason comes from:** the situation of the item's first step group with something left for this person. A pending adjustment on this person's own proposal gives `whyAdjustment`.

- [ ] **Step 1: Write the failing test** in `verify-chapter-roster.mts`: `"te toca dice por qué"`. `rosterOf` with `reasons: new Map([["n1", "Ana propone un cambio"]])` gives row `n1` with `reason === "Ana propone un cambio"`. A row whose status is not `mine` has no `reason`.
- [ ] **Step 2: Run it.** Run: `npm run verify:chapter-roster`. Expected: FAIL (`reason` undefined).
- [ ] **Step 3: Implement it** and change the words.
- [ ] **Step 4: Run the tests.** Run: `npm run verify:chapter-roster && npm run verify:config && npx tsc --noEmit -p .`. Expected: pass. Then commit «Chapter list: agreed notes, and why it is your turn».

### Task 7: Walk it as the team

- [ ] **Step 1:** With the mock (issue 100, Ester 2:1–4, or a new one) and the cutoff moved locally, walk the whole flow as ana, bea and carla at 375 px:
  1. ana opens a note and says «Sí, todo se cumple»;
  2. bea agrees, and carla says «No del todo…» and asks;
  3. ana answers in the conversation;
  4. carla agrees, and the note is agreed;
  5. on another note: ana proposes, bea suggests an adjustment, ana accepts it, and bea and carla agree in all three steps.
- [ ] **Step 2:** Pass the checklist of `docs/FILOSOFIA_DE_DISENO.md` on the four situations, with numbers:
  - controls in view;
  - targets under 44 px;
  - one filled button;
  - screen heights;
  - gaps between groups and inside them, measured.

  Do it at 375 px, in Portuguese, and at 1280 px. Fix what fails, revert the cutoff, run `npx tsc --noEmit -p .` and the verify scripts of Tasks 1–6, and commit «Checklist: … (layout)» if anything changed.

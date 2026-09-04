# UI/UX principles for Gateway Tasks

Gateway Tasks is a 5-step wizard (Contexto → Inventario → Equipos → Asignar →
Publicar) used by a small number of PM/reviewer users, often working through
hundreds of items per book. The main failure mode we keep re-discovering is
**simultaneous density**: every control that *could* be relevant is rendered
at once, so the screen that matters most (Equipos) turns into a wall of
checkboxes, selects and paragraphs before the user has done anything.

These rules exist so the next change doesn't reintroduce that. They're not
novel — they're standard interaction-design heuristics, restated with this
app's screens as the worked examples so they're actually checkable in review.

## The rules

### 1. Progressive disclosure: show consequences, not possibilities
(Nielsen Norman Group, "Progressive Disclosure"; originally Jef Raskin.)

Show the small set of options most people need now. Move everything else
behind an explicit, labeled action — a button, a toggle, a `+ Add` chip —
instead of rendering it disabled or empty "in case it's needed."

- **Don't**: render 4 resource rows, 3 of them empty checkboxes with two
  disabled `<Select>`s each, because a team *could* use any of them.
- **Do**: show only the resources actually added to the team, plus a row of
  small `+ Notas` / `+ Academia` chips to add more. *(Equipos, resource
  picker.)*
- **Do**: collapse a field behind `+ Añadir descripción de fase` /
  `+ Añadir a mano` when it's optional and empty, but auto-expand it the
  moment it holds real data (editing a team that already has a description,
  applying a preset that has one). Never hide data the user already entered.
- **Do**: collapse explanatory paragraphs behind a `¿Cómo funciona?` /
  `¿Qué es esto?` toggle instead of always rendering them. A first-time user
  can open it; a returning user shouldn't have to scroll past it every time.

### 2. One thing is closed by default: the thing you already have
A form for creating a new X should stay open when there is no X yet (empty
state = guide the user in), and collapse to a `+ New X` button once at least
one X exists. Editing an existing X reopens the form. This is why the
"Nuevo equipo" card in Equipos collapses after the first team is saved, and
why "Contexto" only shows the auto-derived content org as an editable field
when it's been customized (`Avanzado: organización de contenido (…)`
otherwise).

### 3. Hick's Law: fewer simultaneous choices, not fewer eventual choices
Decision time grows with the number of visible options. Splitting one
25-control form into "5 controls now, more after you act" doesn't remove
capability, it removes the tax of scanning past 20 irrelevant controls to
find the one that matters. Prefer sequential disclosure (checkbox → its
options appear) over parallel disclosure (every option always visible,
disabled until checked).

### 4. Miller's Law / grouping: chunk related controls, don't let them free-float
A single `flex flex-wrap` row that mixes identity (which team), status
(scope badges) and filters (chapter, search) reads as one undifferentiated
blob once it wraps to 3 lines on a narrow screen. Group by *kind of
decision*, one visual row per group, even if that means more rows:

1. **Identity** — what am I looking at (team/book/step).
2. **Description / status** — read-only context (badges, counts).
3. **Filters** — things that narrow the list.
4. **Actions** — things that change data.

*(This is why AssignView's toolbar is now team-select / badges / filters as
three rows instead of one wrapping row.)*

### 5. Visual hierarchy must be legible, not just present
A section title and a form-field label must not share the same size and
weight — if they do, the eye has no anchor and everything reads as one
paragraph of controls. Concretely, in this codebase:

- `CardTitle` (section/card headings, e.g. "Integrantes", "Asignar") is
  `font-semibold`; `Label` (field labels, e.g. "Nombre", "Capítulo") is
  `font-medium`. Never make a field label as heavy as a card title.
- A **sub-section** inside a card (e.g. "Alcance y grano por recurso",
  "Empezar desde un preset") is neither — use the small-caps "eyebrow" style
  already established in PublishView: `text-xs font-semibold uppercase
  tracking-wide text-muted-foreground`. Don't reuse `<Label>` for these; a
  `<Label>` implies "this describes the control right below it," an eyebrow
  implies "this titles the group below it."
- Exactly **one primary action** (`variant="default"`) per visible section.
  Everything else competing for attention in that section is `outline`,
  `secondary`, or `ghost`. If two actions in the same header both look
  primary, one of them is wrong.

### 6. Recognition over recall
Don't make the user remember what they set up last time. Prefer inline
summaries (badges showing the resolved filter/grain, the `N ítems` count
next to a checked resource) over requiring the user to re-open a control to
check its current value. This is also the reasoning behind **presets**: the
tool should remember a team's shape so the user isn't reconstructing it from
memory for every new book.

### 7. Never trap data behind a closed disclosure
Anything the user has already entered (a description, a manually-added
person, a saved preset) must always be visible, even if the *editor* for it
is collapsed. Collapse controls, not content.

## A pre-merge checklist for new screens/forms

Before adding a control to an existing view, ask:

- [ ] Does this need to be visible before the user has taken the action that
      makes it relevant? If not, gate it behind a toggle/chip/button.
- [ ] Is this row doing one job (identity, status, filter, or action)? If it
      mixes two, split it.
- [ ] If this is a heading, is it a `CardTitle`, an eyebrow `<h3>`, or a
      `<Label>` — and does that match what it's labeling (a screen, a group,
      or a single field)?
- [ ] Is there more than one `variant="default"` button visible at once in
      this section?
- [ ] If I hide this by default, is there still a way to reach it in one
      click, and does it stay visible once it holds real data?

## Where the underlying idea comes from

- Jakob Nielsen / Nielsen Norman Group — *10 Usability Heuristics for User
  Interface Design*, and *Progressive Disclosure*.
- Hick's Law (Hick, 1952; Hyman, 1953) — choice reaction time grows with the
  number of alternatives.
- Miller's Law (Miller, 1956) — working memory holds roughly 7±2 chunks;
  group related controls into chunks instead of presenting them flat.
- Gestalt principle of proximity — controls placed close together are read
  as related; controls that are related should be placed close together and
  nothing else should sit between them.

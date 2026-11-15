# ADR-194: C4 Manual Positions Are Merged at the Hand-Edit Commit, Not Cleared

**Date:** 2026-11-15
**Status:** Accepted
**Supersedes:** none
**Amends:** none
**Issue:** #194 (verveguy/liminis-editor)

## Context

`@liminis/diagrams` 0.2.0 lets a user add elements and relationships on the
rendered C4 diagram. The renderer reports `onEdit(edit, { positions })`; the
host turns the edit into source with `applyC4Edit` and stores the reported
`positions`, which is the complete, already-merged map.

The C4 node could not adopt this. `C4Component` had an effect ("TASK 7") that
cleared the whole manual layout whenever the set of element ids differed from
the layout's keys. Adding one box from the diagram changes that set, so every
position the user had arranged would have been discarded the moment they added
something.

## Decision

### 1. A diagram edit replaces code and layout in one `editor.update`

`handleEdit` reads the source from the **node** (never from component state,
which lags by a render), calls `applyC4Edit`, and on success calls
`setCode(result.source)` and `setManualLayout({ positions: context.positions })`
in the same update. One update is one history entry, so a single undo restores
both. `context.positions` is stored as received: not filtered, not merged with
the old layout. On `{ ok: false }` nothing is mutated, so there is no history
entry; `code` and `message` are logged with `console.warn`.

### 2. A hand edit merges at the commit, in the same update as `setCode`

The only point where a hand edit reaches the Lexical node is `onHide`
(`node.setCode(codeValue)`). The merge runs there: `mergeManualLayout` keeps the
positions of ids still present in the parsed source and any reserved `__` key
(such as `__legend__`), and drops the rest. It is a no-op (same object) when
nothing is dropped, and yields `undefined` when nothing is left. A source that
fails to parse, or parses with errors, never drops anything. An unchanged close
no longer dirties the node.

### 3. The display renders from a `{ code, manualLayout }` snapshot

`C4DiagramDisplay` reads both from the node together, in its initial state and in
`registerUpdateListener`, instead of taking `code` from a prop that is synced in
an effect. A diagram edit or undo/redo therefore never renders new positions
against old code (the "visible jump" the diagrams recipe warns about).

### Alternatives rejected

- **An effect that merges when ids change.** It can run with the new layout
  (containing the just-placed id) before the new code reaches the display, see an
  id absent from the parsed diagram, and drop the position it was meant to keep.
  Undo and redo have the same ordering problem. Telling diagram-originated
  changes from hand edits with a ref flag is order-dependent and fragile.

## Consequences — what this costs

- **The layout is no longer cleared on an id-set change.** A hand-added element
  is auto-placed beside existing pinned ones, and the result may not look as
  tidy as a full re-layout did. "Reset to auto layout" remains the way to start
  over.
- **A renamed id loses its position.** The old id is dropped and the new id has
  none; the merge cannot tell a rename from a remove plus an add.
- **Clearing the source drops every position.** An empty source parses cleanly
  with zero elements, so all positions go. Only a parse that fails, or reports
  errors, is protected.
- **`setCode` callers other than the editor commit are not covered.** The merge
  lives in `onHide`, not in `C4Node.setCode`. Anything else that later changes a
  C4 node's code (a host, an import, collaboration) must merge the layout itself
  or leave stale positions for removed ids. Stale keys are harmless to rendering
  (the layout ignores unknown ids) but are written to the `@layout` fence meta
  until the next hand edit prunes them. `C4Node` was deliberately not given this
  logic: it must not import `@liminis/diagrams` statically (ADR-075, ADR-079).
- **Structural editing is only available in layout-edit mode.** The
  interactive renderer is only mounted while the user is editing layout, and the
  renderer shows its add affordances only in edit mode.
- **Hand-edit merging is validated against `parseC4` element ids**, which include
  boundaries and nested elements (covered by tests). Whether the renderer keys
  boundary positions identically was checked against the 0.2.0 type
  declarations, not against a rendered diagram.

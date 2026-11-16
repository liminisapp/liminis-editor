# Feature Specification: C4 node: adopt structural editing and merge manual positions instead of clearing them

**Feature Branch**: `fabrik/issue-194`
**Created**: 2026-11-15
**Status**: Specified
**Input**: User description: "## Problem

`@liminis/diagrams` can now add elements and relationships from the rendered diagram (liminisapp/liminis-diagrams#92, merged in liminisapp/liminis-diagrams#93, published in 0.2.0). The renderer reports an edit through `onEdit(edit, { positions })`, and the host applies it to the source text. `positions` is the complete, already-merged position map after the edit, not just the new element's position.

This repo's C4 node can't adopt that safely yet. `src/app/editor/nodes/C4Component.tsx` has a \"TASK 7\" effect that **clears the whole manual layout whenever the set of element ids changes**. With structural editing, adding a single box changes the id set, so every position the user arranged would be thrown away the moment they add something.

## Desired outcome

The C4 node supports structural editing end to end:
- An `onEdit` from the renderer is applied with `applyC4Edit` to the node's code, and `context.positions` replaces the node's manual layout, **in the same `editor.update`** (`node.setCode` and `node.setManualLayout` together). One update means one history entry, and it avoids the visible jump the diagrams recipe warns about when the two are stored separately. If `applyC4Edit` returns `{ ok: false, code, message }`, neither the code nor the layout changes.
- Manual positions are **merged**, not cleared, when the source is edited by hand (the code editor, not the diagram). When the id set changes, keep the positions of ids that still exist and drop those that no longer exist.

## Acceptance criteria

- [ ] Replace the TASK 7 clear-on-id-change effect with merge behaviour for hand edits to the source. Removing an element in the source drops only that element's position. Adding one keeps all the others.
- [ ] Adding an element or a relationship from the diagram inserts exactly the line(s) `applyC4Edit` returns into the node's code. The new element appears where it was placed, and nothing else moves.
- [ ] The first structural edit pins all visible nodes, as the renderer reports (liminisapp/liminis-diagrams#92 Q6). The host stores the reported `positions` map as-is.
- [ ] Undo after an add from the diagram reverts both the source line and the new position in **one** step.
- [ ] A failed `applyC4Edit` leaves code and layout unchanged.
- [ ] The markdown round-trip (`lexicalToMdast` `convertC4Node()`) still writes the edited code and positions.

## Dependencies

Satisfied: `@liminis/diagrams` 0.2.0 is published with `onEdit`, `applyC4Edit`, `parseC4WithSpans` and `generateC4Alias`, and this repo has been on `^0.2.0` since #202.

## Pointers

- `src/app/editor/nodes/C4Component.tsx`, the TASK 7 effect
- liminis-diagrams docs: Recipes, \"The host's half\" (a worked host example covering apply-edit and merge-positions)
- liminis-diagrams `src/playground/C4Playground.tsx`, the reference host"

## Background

`@liminis/diagrams` 0.2.0 lets a user add elements and relationships directly on the rendered C4 diagram. The renderer reports each edit as `onEdit(edit, { positions })`; the host turns the edit into source text with `applyC4Edit` and stores the reported positions. `positions` is the complete, already-merged map after the edit, not only the new element's position. This repo is on `^0.2.0` (since #202), so the capability is available but not wired up.

The C4 node cannot adopt it safely today. Its "TASK 7" behaviour clears the entire manual layout whenever the set of element ids changes. Adding one box from the diagram changes the id set, so every position the user had arranged would be discarded at once. Structural editing therefore needs two changes together: the node must apply diagram edits (code and layout stored atomically), and hand edits to the source must stop clearing the layout and instead keep the positions of ids that survive.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add an element or relationship from the diagram (Priority: P1)

A user viewing a C4 diagram in the editor adds a new element or a relationship using the diagram's own editing affordances. The source code gains the corresponding line(s), the new element appears where they placed it, and every other element stays where it was.

**Why this priority**: This is the feature. Without it, the renderer's new capability is unusable in this editor.

**Independent Test**: Arrange some elements manually, add a new element from the diagram, and check that the code gained exactly the line(s) `applyC4Edit` returned and that no existing element moved.

**Acceptance Scenarios**:

1. **Given** a C4 node with manually arranged elements, **When** the user adds an element from the diagram, **Then** the node's code gains exactly the line(s) returned by `applyC4Edit`, the new element appears at its placed position, and all other elements keep their positions.
2. **Given** a C4 node with no manual layout yet, **When** the user makes the first structural edit, **Then** the reported `positions` map (which pins all visible nodes) is stored as the node's manual layout exactly as received.
3. **Given** a C4 node, **When** the user adds a relationship from the diagram, **Then** the node's code gains exactly the relationship line(s) returned by `applyC4Edit` and no element positions change.

---

### User Story 2 - Undo a diagram edit in one step (Priority: P1)

After adding something from the diagram, the user presses undo. The added source line and the new position disappear together.

**Why this priority**: Storing code and layout in separate updates would create two history entries and a visible jump; atomicity is a stated requirement of the issue.

**Independent Test**: Add an element from the diagram, undo once, and verify both the source line and the stored position are reverted; redo restores both.

**Acceptance Scenarios**:

1. **Given** an element was just added from the diagram, **When** the user undoes once, **Then** the code and the manual layout both return to their prior state with no intermediate state rendered.
2. **Given** that undo, **When** the user redoes, **Then** the added line and the position are both restored.

---

### User Story 3 - A rejected edit changes nothing (Priority: P1)

When `applyC4Edit` cannot apply an edit (it returns `{ ok: false, code, message }`), the node's code and layout are left exactly as they were.

**Why this priority**: Prevents partial or corrupted state, and prevents a position being stored for an element that does not exist in the source.

**Independent Test**: Trigger an edit that `applyC4Edit` rejects and confirm code and layout are unchanged and no history entry is created.

**Acceptance Scenarios**:

1. **Given** `applyC4Edit` returns `ok: false`, **When** the renderer reports the edit, **Then** neither the node's code nor its manual layout changes.

---

### User Story 4 - Hand-editing the source keeps the layout (Priority: P1)

A user edits the C4 source text by hand (in the code editor, not the diagram), adding or removing elements. Positions of elements that still exist are kept; positions of elements that no longer exist are dropped.

**Why this priority**: Replaces the clear-on-id-change behaviour; without this, hand edits would still wipe the user's arrangement.

**Independent Test**: With a manual layout in place, add a line in the source and verify all positions remain; remove an element's line and verify only that element's position is dropped.

**Acceptance Scenarios**:

1. **Given** a manual layout covering elements A, B, C, **When** the user hand-adds element D to the source, **Then** positions for A, B and C are unchanged.
2. **Given** a manual layout covering A, B, C, **When** the user hand-removes element B from the source, **Then** only B's position is dropped and A and C keep theirs.

---

### User Story 5 - Saved markdown reflects edited code and positions (Priority: P2)

The markdown the editor writes for a C4 node includes the edited code and the current positions, whether the change came from the diagram or from hand edits.

**Why this priority**: Existing behaviour that must not regress; persistence correctness.

**Independent Test**: Make a diagram edit and a hand edit, serialize to markdown, and confirm both code and positions appear as expected.

**Acceptance Scenarios**:

1. **Given** a C4 node edited from the diagram, **When** the document is converted to markdown, **Then** the output contains the edited code and the stored positions.

---

### Edge Cases

- Hand edit on a node with no manual layout: nothing to merge, no layout is created.
- Hand edit that leaves the source temporarily unparseable (mid-typing): positions are not dropped on the strength of a failed parse. Only ids that are genuinely absent from a successfully parsed source lose their position.
- Hand edit that renames an element id: the old id's position is dropped and the new id has none (auto-laid-out as usual).
- Reserved position keys (those starting with `__`, which the existing code excludes when comparing ids) are not treated as element ids and are preserved by the merge.
- Undo/redo of a hand edit or diagram edit restores code and layout together; the merge behaviour must not corrupt the restored state.
- A merge that drops no ids and adds none should not create a spurious layout update or history entry.
- A diagram edit is the source of truth for positions at that moment: the reported map replaces the layout rather than being merged with the old one.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the renderer reports an edit, the C4 node applies it to the node's current code with `applyC4Edit`.
- **FR-002**: On success, the node's code and manual layout are updated together in a single editor update, producing one history entry.
- **FR-003**: On success, the manual layout is replaced by the `positions` map reported with the edit, stored as received (not re-merged, filtered or recomputed).
- **FR-004**: On failure (`ok: false`), neither the code nor the manual layout changes and no history entry is created.
- **FR-005**: An element or relationship added from the diagram inserts exactly the line(s) that `applyC4Edit` returns, and nothing else in the code changes.
- **FR-006**: The first structural edit on a node without a manual layout stores the full reported positions (all visible nodes pinned), as the renderer reports.
- **FR-007**: The behaviour that clears the manual layout when the set of element ids changes is removed.
- **FR-008**: When the source is changed by hand and the element id set changes, positions for ids still present are kept and positions for ids no longer present are dropped.
- **FR-009**: The merge in FR-008 applies only to source changes not originating from a diagram edit; a diagram edit's reported positions are never overwritten by a merge.
- **FR-010**: Undoing a diagram edit reverts source and positions together in one step; redo restores both.
- **FR-011**: The markdown serialization of the C4 node continues to write the node's current code and positions.
- **FR-012**: Leaving edit mode / layout-editing state is no longer forced by an id-set change, since the layout is no longer cleared. (The state handling must remain consistent with the layout now persisting.)

### Key Entities *(if applicable)*

- **C4 node**: The document node holding C4 source code and an optional manual layout (map of element id to position).
- **Manual layout / positions**: Map from element id to a position; may contain reserved `__`-prefixed keys that are not element ids.
- **Edit and edit context**: What the renderer reports on a structural edit: the edit description plus the complete, already-merged positions map.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After adding an element from the diagram, 100% of previously positioned elements keep their exact positions.
- **SC-002**: One undo after a diagram edit restores both the prior source and the prior layout; there is exactly one history entry per diagram edit.
- **SC-003**: Removing one element by hand drops exactly one position; adding one by hand drops zero.
- **SC-004**: A rejected edit produces zero changes to code, layout and history.
- **SC-005**: Markdown output after a diagram edit or hand edit contains the updated code and positions, verified by an existing/updated round-trip test.

## Assumptions

- `@liminis/diagrams` 0.2.0's `onEdit`, `applyC4Edit`, `parseC4WithSpans` and `generateC4Alias` behave as documented in the diagrams repo's "The host's half" recipe and reference playground host; this spec treats the reported `positions` as authoritative.
- Surfacing a user-visible error message for a failed `applyC4Edit` is not required; leaving state unchanged is sufficient. (`message` may be logged.)
- Distinguishing hand edits from diagram edits is a plan-level concern; the spec only requires that the two behaviours (replace on diagram edit, merge on hand edit) not interfere.
- Per the repo's release conventions this is additive and ships under `## Unreleased` in the CHANGELOG; no version bump is part of this issue.

## Out of Scope *(optional)*

- Editing or deleting existing elements/relationships from the diagram (only add is covered by the renderer's current capability).
- Changes to `@liminis/diagrams` itself.
- Auto-layout algorithm changes for elements without positions.
- Other diagram types or other node types.

## Source References *(optional)*

- liminisapp/liminis-diagrams#92 (design, incl. Q6 on pinning) and #93 (implementation); `@liminis/diagrams` 0.2.0
- liminis-diagrams docs: Recipes, "The host's half"
- liminis-diagrams `src/playground/C4Playground.tsx` (reference host)
- This repo: #202 (upgrade to `@liminis/diagrams` ^0.2.0)

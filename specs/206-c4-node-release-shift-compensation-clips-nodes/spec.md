# Feature Specification: C4 node: release-shift compensation must not clip nodes dropped past the top edge

**Feature Branch**: `fabrik/issue-206`
**Created**: 2026-11-16
**Status**: Specified
**Input**: User description: "## Problem

Since #205 (#203), a C4 node dropped partly **above the diagram's top edge** ends up clipped: the visible area doesn't grow to include it. Reproduced in the demo app with a node dragged up past the top of the diagram and released. Only the bottom edge of the box stays visible, under the paragraph above.

Cause: the diagram's frame does grow to include the node. To cancel the release shift that growth causes, #205 translates the svg back by the growth (`svg.style.translate`, ADR-203). A translate is visual only, so the container's box doesn't grow. The grown strip is moved above the container's top edge and clipped there (`overflowX: auto` makes the container clip vertically too, and it has only `1rem` of padding). ADR-203's \"Cost\" section records this (\"Nothing is un-clipped\"). In practice it means any node dropped above the top is partly hidden, which is worse than the jump #203 removed.

Horizontal growth is mostly unaffected. A centred diagram usually has spare width, so the translate seldom moves content past the container's edges.

## Desired outcome

Dropping a node past the top edge leaves it **fully visible** and **under the pointer**. The container grows to fit the new frame, and the jump is cancelled by scrolling, not by translating.

- **Vertical:** don't translate for top growth. Let the frame grow and push content down, then scroll the nearest vertically scrolling ancestor (the editor's scroller, or the document) down by the same amount, so the diagram keeps its screen position. Scrolling down to cancel top growth almost always has range. When it doesn't (a short, non-scrolling document), accept the shift: a visible jump is better than clipped content.
- **Horizontal:** prefer the container's `scrollLeft` when the content overflows it. Otherwise keep the current translate (the centred, narrow case), but never translate content past the container's edges. Where the translate would clip, fall back to the shift.
- Keep `overflow-anchor: none` (or an equivalent) so scroll anchoring doesn't add a second adjustment.

## Acceptance criteria

- [ ] Dragging a node past the top edge and releasing: the node is fully visible after the drop, and its screen position is unchanged (within 1px) wherever the scroll ancestor has the range.
- [ ] The same in a document that's already scrolled, and in a scrollable editor pane that isn't the document.
- [ ] A short, non-scrolling document: the node is fully visible, and the shift is allowed.
- [ ] Left, right and corner growth: no content clipped by the compensation. No jump wherever compensation is possible without clipping.
- [ ] Drags that don't grow the frame change nothing.
- [ ] The existing release-shift unit tests and the e2e spec (`examples/electron/e2e/c4-release-shift.spec.ts`) are updated. The e2e spec asserts the dropped node's box lies inside the visible area, not only that it didn't move.
- [ ] ADR-203 gets a dated amendment saying the translate-only approach was replaced for vertical growth, and why. Amend; don't rewrite it.

## Pointers

- `src/app/editor/nodes/C4Component.tsx`: `handlePositionChange` (the release snapshot), the no-dependency `useLayoutEffect` (offset and translate), and the container style (`overflowX: auto`, `padding: 1rem`, `overflowAnchor: none`)
- `docs/decisions/adr-203-c4-release-shift-compensation.md`: \"Alternatives\" (the rejected `scrollLeft`/`scrollTop` option) and \"Cost\"
- liminis-diagrams ADR-100: the release shift, and the 48px growth cap near the scroll container's edge"

## Background

When a C4 diagram node is dragged past an edge in layout mode, the diagram's frame grows live to include it (liminis-diagrams ADR-100). On release the renderer's origin jumps to the natural origin of the larger frame. #203/#205 (ADR-203) cancelled that jump by measuring it and translating the diagram's `<svg>` back by the same amount.

A translate is visual only. The container's layout box does not grow, so for top growth the grown strip is moved above the container's top edge and clipped there. The container clips vertically because of its horizontal overflow setting, and it has only 1rem of padding. A node dropped partly above the top therefore ends up mostly hidden, with only its bottom edge visible under the preceding paragraph. That is worse than the jump #203 removed. ADR-203's "Cost" section recorded this trade-off ("Nothing is un-clipped"), and in practice it proved unacceptable. ADR-203 also rejected scroll adjustment because a narrow, centred diagram has no horizontal scroll range and `scrollTop` cannot go negative; that reasoning needs revisiting because the container itself now grows and the *ancestor* scrolls.

Horizontal growth is mostly unaffected today: a centred diagram usually has spare width, so the translate rarely pushes content past the container's edges.

The desired model: let the container grow to fit the new frame, then cancel the jump by scrolling where there is range. Where there is no range, accept a visible shift rather than clip content.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Node dropped above the top edge stays visible and under the pointer (Priority: P1)

A user in layout mode drags a C4 node up past the top of the diagram and releases it. The node is fully visible and stays where the pointer dropped it.

**Why this priority**: This is the regression. Content is currently hidden, so the user cannot see or reach the node they just placed.

**Independent Test**: In the demo app, drag a node above the diagram's top edge and release. Measure the node's box against the visible area and compare its screen position before and after release.

**Acceptance Scenarios**:

1. **Given** a document with enough scroll range, **When** a node is dropped past the top edge, **Then** the node's box lies fully inside the visible area and its screen position is unchanged within 1px.
2. **Given** a document already scrolled partway down, **When** the same drop is performed, **Then** the same outcome holds.
3. **Given** the diagram sits in a scrollable editor pane that is not the document, **When** the same drop is performed, **Then** the pane scrolls to compensate and the same outcome holds.

---

### User Story 2 - Short, non-scrolling document degrades to a visible shift (Priority: P1)

When no scroll ancestor has range to absorb top growth, the node is still fully visible, even though the diagram shifts.

**Why this priority**: The "never clip" guarantee must hold in every environment, not only scrollable ones.

**Independent Test**: In a document short enough not to scroll, drop a node past the top edge and check that its box is fully visible.

**Acceptance Scenarios**:

1. **Given** a document with no vertical scroll range, **When** a node is dropped past the top edge, **Then** the node is fully visible and the diagram is allowed to shift.

---

### User Story 3 - Horizontal and corner growth never clips (Priority: P2)

Dropping a node past the left, right or a corner edge clips nothing, and does not jump wherever cancelling is possible without clipping.

**Why this priority**: The existing translate behaviour is mostly right horizontally, but it must be guarded so it can never clip. The change must not regress the common centred-diagram case.

**Independent Test**: Drop nodes past the left, right and each corner. Assert full visibility and, where possible, an unchanged screen position.

**Acceptance Scenarios**:

1. **Given** content that overflows the container horizontally, **When** a node is dropped past a left or right edge, **Then** the container's horizontal scroll position cancels the jump.
2. **Given** a narrow, centred diagram with spare width, **When** a node is dropped past a side, **Then** the existing translate cancels the jump and no content leaves the container's edges.
3. **Given** a case where the translate would push content past the container's edges, **When** the node is dropped, **Then** the shift is allowed and nothing is clipped.
4. **Given** a corner drop, **When** the node is released, **Then** the vertical and horizontal rules apply independently and nothing is clipped.

---

### User Story 4 - Drags that don't grow the frame change nothing (Priority: P2)

**Why this priority**: Guards against regressions in the most common interaction.

**Independent Test**: Drag a node within the existing frame and release. Check that no scroll position or offset changes.

**Acceptance Scenarios**:

1. **Given** a drag that leaves the frame unchanged, **When** the node is released, **Then** no scroll position, translate or other layout value changes.

---

### Edge Cases

- A cancelled drag (no release snapshot) changes nothing.
- Growth on several sides in one drag, and growth deferred to release by the renderer's 48px cap (the cap cannot engage in this editor today because it never passes `zoom`).
- Net growth smaller than peak growth.
- Container already scrolled horizontally before the drop.
- Nested scrollers: the nearest vertically scrolling ancestor is the one scrolled; if there is none, the document scrolls.
- Scroll range that is only partial (less than the growth): compensate as far as the range allows, and never clip.
- Exiting layout mode resets any host-owned offset, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After a frame-growing drag is released, the container's box grows to include the grown frame, so no part of the dropped node is clipped by the container.
- **FR-002**: Top growth is not cancelled with a translate. The release jump is cancelled by scrolling the nearest vertically scrolling ancestor (the editor's scroller, or the document if none) by the amount the diagram moved.
- **FR-003**: When the vertical scroll ancestor has no or insufficient range, the uncancelled remainder is accepted as a visible shift. Content is never clipped to avoid it.
- **FR-004**: Horizontally, when the content overflows the container, the jump is cancelled by the container's horizontal scroll position.
- **FR-005**: Horizontally, when the content does not overflow, the existing translate is kept, but only to the extent that no content ends up past the container's edges. Where the translate would clip, the shift is accepted instead.
- **FR-006**: Scroll anchoring remains disabled on the container (`overflow-anchor: none` or an equivalent) so the browser adds no second adjustment.
- **FR-007**: A drag that does not grow the frame leaves scroll positions and offsets unchanged.
- **FR-008**: Left, right and corner growth are handled with the horizontal and vertical rules applied independently.
- **FR-009**: The host-owned offset still resets when layout mode exits.
- **FR-010**: The existing release-shift unit tests are updated to the new behaviour, with added cases for vertical scroll compensation (document and non-document scroller), no scroll range, and the horizontal translate-versus-scroll fallbacks.
- **FR-011**: The e2e spec `examples/electron/e2e/c4-release-shift.spec.ts` is updated to assert that the dropped node's box lies inside the visible area, in addition to its screen position being unchanged within 1px where the scroll ancestor has range.
- **FR-012**: ADR-203 receives a dated amendment, appended rather than rewritten, stating that the translate-only approach was replaced for vertical growth and why. The amendment also revisits the "Alternatives rejected" scroll option and the "Cost" section's "Nothing is un-clipped" statement.

### Key Entities *(if applicable)*

- **Release shift**: The jump of the diagram's origin on release, when the renderer clears its live transform and the larger frame takes its natural origin.
- **Host-owned offset**: The per-instance translate the C4 node applies to cancel the shift where scrolling cannot.
- **Scroll ancestor**: The nearest vertically scrolling ancestor of the diagram container, or the document.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After dropping a node past the top edge, 100% of the node's box lies inside the visible area, in the document-scroller, already-scrolled and non-document-scroller cases.
- **SC-002**: Wherever the scroll ancestor has range, the dropped node's screen position changes by at most 1px between just before and just after release.
- **SC-003**: In a non-scrolling document, the dropped node is fully visible after release, whether or not it has shifted.
- **SC-004**: For left, right and corner drops, no part of the diagram is clipped by the compensation, and the screen position is unchanged within 1px wherever compensation is possible without clipping.
- **SC-005**: A drag that does not grow the frame produces no change in scroll position or offset.
- **SC-006**: The updated unit tests and e2e spec pass, and the e2e spec fails if the container clips a top-dropped node.

## Assumptions

- The compensation continues to be measured from the diagram's screen position before and after release, as in ADR-203. This issue changes how the measured shift is applied, not how it is measured.
- "Visible" for acceptance means within the visible area of the nearest scrolling ancestors and the viewport. A node covered by other page content is not what the criterion tests.
- When the scroll range is only partial, compensating as far as the range allows and accepting the remainder is preferred to all-or-nothing.
- Top growth uses no translate at all. Any visual offset that remains after scrolling is accepted as a shift.
- The editor's behaviour with zoom-to-fit and the 48px growth cap is unchanged. The editor never passes `zoom`, so the cap cannot engage today.
- The container padding of 1rem is not increased as a way of working around the clipping.

## Out of Scope *(optional)*

- Changes to `@liminis/diagrams` (renderer behaviour, `onFrameChange`, the growth cap).
- Using `onFrameChange` as the measurement source (rejected in ADR-203).
- Bottom-edge growth, which does not move the origin and so causes no shift.
- Re-centring the diagram after a drop. It stays where the user dropped it until layout mode exits.
- Zoom-to-fit support.

## Source References *(optional)*

- Issue #206, and #203 / PR #205 (the original release-shift compensation)
- `docs/decisions/adr-203-c4-release-shift-compensation.md` ("Alternatives rejected" and "Cost")
- `src/app/editor/nodes/C4Component.tsx` (`handlePositionChange`, the no-dependency `useLayoutEffect`, the container style)
- `examples/electron/e2e/c4-release-shift.spec.ts`
- liminis-diagrams ADR-100 (release shift and the 48px growth cap)

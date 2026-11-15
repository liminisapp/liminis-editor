# Feature Specification: C4 node: compensate scroll for the release shift after a frame-growing drag

**Feature Branch**: `fabrik/issue-203`
**Created**: 2026-11-15
**Status**: Specified
**Input**: User description: "## Problem

Since `@liminis/diagrams` 0.2.0 (ADR-100), the C4 diagram's SVG frame grows live while a node is dragged past its edge. The renderer holds the diagram's origin steady with a CSS translate during the drag, then applies a one-time shift on release. The library accepts that shift; compensating for it is the host's job.

The editor's C4 node (`src/app/editor/nodes/C4Component.tsx`) wraps the renderer in a flex-centred (`justifyContent: 'center'`), horizontally scrolling (`overflowX: 'auto'`) container. So, on release:
- dragging past the **top or left** edge shifts the whole diagram by the growth, and
- because the container centres its content, growth on **any** horizontal side shifts the diagram by half the growth.

To the user, the diagram jumps under the pointer when they let go.

## Desired outcome

After a drag that grows the frame, the node the user dropped stays where they dropped it on screen. The host adjusts the container's scroll position (and/or its centring) on release to cancel the shift.

## Acceptance criteria

- [ ] Dragging a node past the left or top edge and releasing leaves the dropped node at the same screen position (within 1px).
- [ ] Dragging past the right edge in the centred container leaves the dropped node in place too (the half-growth case).
- [ ] Drags that don't grow the frame change nothing.
- [ ] The renderer's frame-growth signal (`onFrameChange`) is used if it's the right hook; otherwise the issue records why not.
- [ ] Behaviour near the renderer's growth cap (within 48px of the scroll container's edge) is checked and doesn't cause a jump either.

## Pointers

- liminis-diagrams `adrs/100-freeze-svg-frame-during-drag.md`: the release shift, the centring-host case, `onFrameChange`, the 48px cap
- `src/app/editor/nodes/C4Component.tsx`: the centred `overflowX: auto` wrapper around `C4InteractiveRenderer`
- Split out of #194, which covers structural editing and merging positions."

## Background

Since `@liminis/diagrams` 0.2.0 (ADR-100), the C4 diagram's drawing area grows live while the user drags a node past its edge, so a node can be pulled beyond the original bounds without being clipped. During the drag the renderer keeps the diagram's origin visually steady. When the user releases, the renderer applies a single one-time shift to settle into the final, larger frame. The library deliberately leaves compensating for that shift to the host application.

The editor's C4 node shows the diagram inside a container that centres its content and scrolls horizontally when the diagram is wider than the node. Two effects follow on release:

- Growth past the **top or left** edge moves the diagram's origin, so the whole diagram appears to shift by the amount of growth.
- Because the container **centres** its content, growth on **any** horizontal side (including right) changes the content width and shifts the diagram by half the growth.

For the user, the node they just dropped jumps away from the pointer at the moment they let go. This issue removes that jump. It was split out of #194, which covers structural editing and merging positions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dropped node stays put after growing the frame past the left or top edge (Priority: P1)

A user drags a C4 node beyond the left or top edge of the diagram so the drawing area grows, then releases the pointer.

**Why this priority**: This is the core defect. It is the most visible jump, because the whole diagram moves by the full growth amount.

**Independent Test**: In a C4 node, drag a node past the left edge (and separately the top edge) by a known distance, release, and compare the dropped node's on-screen position immediately before and after release.

**Acceptance Scenarios**:

1. **Given** a C4 diagram displayed in the editor, **When** the user drags a node past the left edge and releases, **Then** the dropped node's on-screen position after release is within 1px of its position just before release.
2. **Given** a C4 diagram displayed in the editor, **When** the user drags a node past the top edge and releases, **Then** the dropped node's on-screen position after release is within 1px of its position just before release.
3. **Given** a drag past a corner (left and top at once), **When** the user releases, **Then** the dropped node stays within 1px of where it was dropped on both axes.

---

### User Story 2 - Dropped node stays put after growing the frame past the right edge in the centred container (Priority: P1)

A user drags a node past the right edge. The container centres its content, so the growth would otherwise shift the diagram by half the growth amount.

**Why this priority**: This is the second half of the reported jump, and it is the case that only exists because of the host's centring.

**Independent Test**: Drag a node past the right edge by a known distance, release, and compare the dropped node's on-screen position before and after release.

**Acceptance Scenarios**:

1. **Given** a C4 diagram in a centred container, **When** the user drags a node past the right edge and releases, **Then** the dropped node's on-screen position after release is within 1px of its position just before release.
2. **Given** a diagram that is narrower than its container and one that is wider and scrolling, **When** the user drags past the right edge and releases, **Then** the dropped node stays within 1px in both.

---

### User Story 3 - Drags that do not grow the frame change nothing (Priority: P1)

A user drags a node around entirely within the existing bounds.

**Why this priority**: The compensation must not regress ordinary dragging or introduce spurious scrolling.

**Independent Test**: Drag nodes within the existing frame, release, and confirm that neither the container's scroll position nor any node's on-screen position changes beyond the drag itself.

**Acceptance Scenarios**:

1. **Given** a C4 diagram, **When** the user drags a node without crossing the frame edge and releases, **Then** the container's scroll position is unchanged and the node's on-screen position matches the drop position within 1px.

---

### User Story 4 - No jump when the drag reaches the renderer's growth cap (Priority: P2)

The renderer limits frame growth to within 48px of the scroll container's edge. A user drags a node into that region, or beyond where growth stops, and releases.

**Why this priority**: It is a boundary condition of the same feature. A jump here would be rarer but would still be a visible defect.

**Independent Test**: Drag a node toward each edge until growth stops, continue dragging past the cap, release, and compare the dropped node's position before and after release.

**Acceptance Scenarios**:

1. **Given** a drag whose frame growth is limited by the cap, **When** the user releases, **Then** the dropped node's on-screen position is within 1px of its position just before release.
2. **Given** a drag that moves back and forth across the cap boundary before release, **When** the user releases, **Then** no jump occurs.

---

### Edge Cases

- Growth on several sides in one drag (for example, left and top, or left and right), followed by a single release.
- A drag that grows the frame and then returns inside the original bounds before release, so net growth is zero or smaller than the peak.
- A diagram narrower than its container (centred with no scrollbar) versus wider than its container (scrolling).
- A container that is already scrolled away from its start position when the drag begins.
- Growth that would require a negative scroll position (content that cannot scroll far enough to compensate); the result should degrade gracefully, without a jump where compensation is possible.
- A drag cancelled (for example by Escape) rather than released: no net shift may remain.
- Multiple C4 nodes in the same document each compensate independently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After a drag that grew the diagram's frame past the left or top edge, the C4 node MUST keep the dropped node at the same on-screen position it had just before release, within 1px.
- **FR-002**: After a drag that grew the diagram's frame past the right edge inside the centred container, the C4 node MUST keep the dropped node at the same on-screen position it had just before release, within 1px.
- **FR-003**: A drag that does not grow the frame MUST NOT change the container's scroll position or the on-screen position of any node.
- **FR-004**: The compensation MUST handle growth on any combination of sides in a single drag, including a net growth smaller than the peak growth.
- **FR-005**: The compensation MUST use the renderer's frame-growth signal (`onFrameChange`) if it provides what is needed. If it does not, the reason MUST be recorded on the issue.
- **FR-006**: Behaviour near the renderer's growth cap (within 48px of the scroll container's edge) MUST be verified, and no visible jump may occur on release in that region.
- **FR-007**: The compensation MUST apply only at release, and MUST NOT introduce visible movement of the diagram during the drag.
- **FR-008**: The compensation MUST apply per C4 node and MUST NOT affect other nodes or the surrounding document layout.
- **FR-009**: The change MUST be covered by automated tests that exercise the left, top and right growth cases, the no-growth case, and the cap case.
- **FR-010**: Release notes MUST follow the repository's conventions (an entry under `## Unreleased`, with no version bump of an unreleased version).

### Key Entities *(if applicable)*

- **C4 node**: The editor node that hosts the interactive diagram in a centred, horizontally scrolling container.
- **Frame growth**: The amount the diagram's drawing area has expanded on each side during a drag, as reported by the renderer.
- **Release shift**: The one-time shift the renderer applies on release when it adopts the grown frame; the host is responsible for cancelling it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After releasing a node dragged past the left, top or right edge, the node's on-screen position differs by no more than 1px from its position just before release.
- **SC-002**: In drags that do not grow the frame, scroll position and node positions change by 0px as a result of the release.
- **SC-003**: Releases within 48px of the scroll container's edge, and releases of drags that hit the growth cap, show no on-screen jump greater than 1px.
- **SC-004**: Automated tests covering each of the cases above pass in CI.

## Assumptions

- The container's flex-centring and horizontal scrolling are existing behaviours that users rely on. The preferred outcome is to cancel the release shift rather than remove centring. Either the scroll position or the centring may be adjusted, provided the on-screen result holds.
- Vertical growth does not scroll the container (only horizontal scrolling exists). Top-edge growth is considered compensated if the dropped node stays put on screen, by whatever means the host chooses.
- The renderer's `onFrameChange` signal may or may not carry enough information (per-side growth, timing relative to the release). Whether it suffices is a finding to be recorded during research or implementation, not a decision made here.
- The 1px tolerance is measured in screen pixels and allows for sub-pixel rounding.
- The change is additive and ships as a patch under `## Unreleased`, per the repository's release conventions.

## Out of Scope *(optional)*

- Structural editing of C4 diagrams and merging positions (tracked in #194).
- Changes to `@liminis/diagrams` itself, including the release shift or the 48px cap. The library's behaviour is taken as given.
- Redesigning the C4 node's layout or removing its centring for reasons unrelated to this shift.
- Compensation for frame changes that happen outside a drag (for example, diagram content edits).

## Source References *(optional)*

- liminis-diagrams `adrs/100-freeze-svg-frame-during-drag.md`: the release shift, the centring-host case, `onFrameChange`, and the 48px cap
- `src/app/editor/nodes/C4Component.tsx`: the centred `overflowX: auto` wrapper around `C4InteractiveRenderer`
- #194: the parent issue this was split from

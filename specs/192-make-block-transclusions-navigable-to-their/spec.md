# Feature Specification: Make block transclusions navigable to their source

**Feature Branch**: `fabrik/issue-192`
**Created**: 2026-11-13
**Status**: Specified
**Input**: User description: "Why are the action item transclusions not clickable to navigate to their original context? I thought transclusions were supposed to be clickable."

> Examples below are synthetic — the source workspace is confidential.

## Background

`![[file#^id]]` transclusion (#119, v0.5.0) renders the referenced block inline, and it works. But there is no way to get from the embedded block to where it lives. A note that carries forward action items like:

```markdown
- **Open since 10/13:** follow up on the review rubric — ask for status.
  ![[daily/2026-10-13-team-sync.md#^01ARZ3NDEKTSV4RRFFQ69G5FAV]]
```

shows the live checkbox and text, but clicking it does nothing, in read-only or editable mode. Users reasonably expect a transclusion to be at least as navigable as a `[[file#^id]]` link.

Root cause (read from v0.7.0 `dist/`):

- `LinkClickPlugin` only reacts to an `<a>` element carrying `data-href` (and optional `data-block-id`), then calls `openLink(url, blockId)` → `OPEN_LINK` to the host.
- `TransclusionComponent` / `transclusion-render.ts` emit only `<span>`s (`editor-transclusion-content`, `-paragraph`, `-list-item`, …) — no `<a>`, no `data-href`, no click handler. So the click plugin never sees a link.
- The block-scoped `OPEN_LINK { url, blockId }` path already exists for `[[file#^id]]` links, so the transclusion only needs to emit the same shape.

Companion host issue: shadoworg/liminis-notes#1318 (host honours `blockId` and scrolls to the block). Related: #181 (one logical item / checkbox state).

## Goal

A resolved transclusion is navigable to its source block, using the existing link semantics:

- Read-only mode: click navigates. Editable mode: Cmd/Ctrl-click navigates (same as wiki links, same `modifier-held` / `links-clickable` cursor feedback).
- Navigation emits `OPEN_LINK` with `url` = the source file and `blockId` = the block id, exactly as a `[[file#^id]]` link does, so hosts that already handle block-scoped links get it for free.
- Prefer a small, unobtrusive source affordance (e.g. a "↗" / source badge at the end of the transclusion, or the whole transclusion container as the link target — design choice for Specify). Clicking a nested wiki link *inside* the transcluded content should still navigate to that link, not the transclusion source.
- Unresolved / circular / depth-exceeded states: the source affordance still navigates to the file (useful for repairing a broken reference).

## Non-goals

- Making the transcluded checkbox writable (toggling the source item). It is currently `readOnly` + `disabled`; related to #181's "one logical item" work and should be decided there or separately.
- Host-side scroll-to-block. That's a host concern (companion issue in `shadoworg/liminis-notes`); the editor's job is to emit `blockId`.
- Changing the markdown syntax or round-trip.

## Acceptance

- Unit/DOM test: a resolved transclusion renders an element with `data-href` = file and `data-block-id` = id; clicking it (read-only) or Cmd-clicking (editable) calls `openLink(file, blockId)` once.
- Clicking a wiki link nested in transcluded content opens that link, not the source.
- No regression to existing transclusion rendering, debounce/re-resolve, or round-trip tests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navigate from a resolved transclusion to its source block (Priority: P1)

A user reading a note sees an embedded block (e.g. a carried-forward action item). They activate a small source affordance on the transclusion and the host opens the source file at that block.

**Why this priority**: This is the whole request — today the transclusion is a dead end, while `[[file#^id]]` links already navigate.

**Independent Test**: Render a resolved transclusion and activate its source affordance; assert `openLink(file, blockId)` is called exactly once, in read-only mode (plain click) and in editable mode (Cmd/Ctrl-click).

**Acceptance Scenarios**:

1. **Given** a read-only editor with a resolved `![[daily/2026-10-13-team-sync.md#^01ARZ3NDEKTSV4RRFFQ69G5FAV]]`, **When** the user clicks the source affordance, **Then** `OPEN_LINK` is emitted once with `url` = the source file and `blockId` = `01ARZ3NDEKTSV4RRFFQ69G5FAV`.
2. **Given** an editable editor with the same transclusion, **When** the user Cmd/Ctrl-clicks the affordance, **Then** the same `OPEN_LINK` is emitted once.
3. **Given** an editable editor, **When** the user clicks the affordance without the modifier, **Then** no navigation occurs and normal editing behaviour is unchanged.
4. **Given** an editable editor, **When** the user holds Cmd/Ctrl over the affordance, **Then** the same `modifier-held` / `links-clickable` cursor feedback as for wiki links is shown.

---

### User Story 2 - Nested links keep their own target (Priority: P1)

Transcluded content can itself contain wiki links. Activating one of those must open that link's target, not the transclusion's source.

**Why this priority**: Without it, the new affordance would hijack existing link behaviour — a regression.

**Independent Test**: Transclude a block containing `[[other-note]]`; click the nested link and assert `openLink("other-note")` is called once and the transclusion source is not opened.

**Acceptance Scenarios**:

1. **Given** a resolved transclusion whose content contains a wiki link, **When** the user activates that nested link, **Then** only that link's `OPEN_LINK` is emitted.

---

### User Story 3 - Repair a broken transclusion (Priority: P2)

When a transclusion is unresolved, circular, or depth-exceeded, the user can still jump to the referenced file to fix the reference.

**Why this priority**: Useful but secondary; broken states are rarer than the resolved case.

**Independent Test**: Render each non-resolved state and activate the affordance; assert `openLink(file, blockId)` is called.

**Acceptance Scenarios**:

1. **Given** a transclusion whose block cannot be found, **When** the user activates the source affordance, **Then** `OPEN_LINK` is emitted with the referenced file (and the referenced block id).
2. **Given** a circular or depth-exceeded transclusion, **When** the user activates the affordance, **Then** the same navigation occurs.

---

### Edge Cases

- A transclusion nested inside another transclusion: each level's affordance navigates to its own source, not the outermost one.
- Re-resolve after the debounce (source content changed): the affordance remains present and keeps pointing at the same file/block.
- A transclusion reference with no block id (whole-file form, if supported): the affordance emits `OPEN_LINK` with the file and no `blockId`.
- Source file paths containing spaces or special characters navigate identically to how `[[file#^id]]` links with such paths do.
- Markdown round-trip: the affordance is presentation only and must not alter serialized output.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every transclusion in the resolved state MUST render a source affordance carrying `data-href` = the source file and `data-block-id` = the block id, the same attributes the link-click handling already recognises for `[[file#^id]]` links.
- **FR-002**: In read-only mode, a plain click on the affordance MUST emit `OPEN_LINK { url, blockId }` exactly once.
- **FR-003**: In editable mode, Cmd/Ctrl-click on the affordance MUST emit the same `OPEN_LINK` exactly once; a plain click MUST NOT navigate.
- **FR-004**: The affordance MUST show the same modifier-held / links-clickable cursor feedback as wiki links.
- **FR-005**: Activating a wiki link nested inside transcluded content MUST navigate to that link's target and MUST NOT navigate to the transclusion source.
- **FR-006**: Unresolved, circular, and depth-exceeded transclusion states MUST also render the affordance, navigating to the referenced file (with the referenced block id when present).
- **FR-007**: The affordance MUST be small and unobtrusive (a trailing "↗"/source badge) and must not make the rest of the transclusion content a navigation target.
- **FR-008**: Existing transclusion rendering, debounce/re-resolve behaviour, and markdown round-trip MUST be unchanged.

### Key Entities *(if applicable)*

- **Transclusion**: an embedded `![[file#^id]]` reference rendering another file's block inline; has a resolution state (resolved, unresolved, circular, depth-exceeded).
- **Source affordance**: the link-shaped element on a transclusion that identifies the source file and block and triggers navigation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of the four transclusion states, an affordance exists whose activation emits exactly one `OPEN_LINK` with the correct file (and block id when present).
- **SC-002**: A host that already handles block-scoped `[[file#^id]]` links navigates from a transclusion with no host-side changes.
- **SC-003**: The existing transclusion, debounce/re-resolve, and round-trip test suites pass without modification.
- **SC-004**: Activating a nested wiki link results in zero `OPEN_LINK` events for the transclusion source.

## Assumptions

- **Affordance design (decided here)**: a small trailing source badge ("↗") rather than making the whole container a link. It is unambiguous about what navigates, cannot conflict with nested links or with caret placement and selection in editable mode, and can be revised later without changing the emitted event.
- The emitted event is identical in shape to the existing `[[file#^id]]` link event; no new event type or host API is introduced.
- Non-resolved states pass the block id along with the file; the host may ignore it if the block no longer exists.
- Keyboard activation of the affordance follows whatever the existing link element already supports; no new keyboard behaviour is specified.
- The release is additive, so it is a patch under the repository's `0.x` rule, with the change recorded under `## Unreleased` in the CHANGELOG.

## Out of Scope *(optional)*

- Making the transcluded checkbox writable (see #181).
- Host-side scroll-to-block (shadoworg/liminis-notes#1318).
- Any change to the markdown syntax or round-trip.
- Making the whole transclusion container a navigation target.
